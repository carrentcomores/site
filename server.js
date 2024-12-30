const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// Initialize uploads directory
const uploadsDir = process.env.UPLOAD_DIR || 'uploads';
if (!fsSync.existsSync(uploadsDir)) {
    fsSync.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
}

// Ensure Excel file directory exists
const excelFilePath = process.env.EXCEL_FILE || 'uploads/reservations.xlsx';
const excelDir = path.dirname(excelFilePath);
if (!fsSync.existsSync(excelDir)) {
    fsSync.mkdirSync(excelDir, { recursive: true });
    console.log('Created Excel directory:', excelDir);
}

// Enable CORS for all origins during development
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false
}));

// Log all requests for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    console.log('Origin:', req.headers.origin);
    console.log('Headers:', req.headers);
    next();
});

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        const uploadDir = process.env.UPLOAD_DIR || 'uploads';
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF and JPEG files are allowed.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 
    }
});

// Serve static files
app.use(express.static('public'));

// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'Car Reservation API',
        endpoints: {
            health: '/health',
            submit: '/submit (POST)',
        },
        status: 'running'
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Semaphore for Excel file access
let isExcelFileLocked = false;
const pendingWrites = [];

// Function to acquire lock
async function acquireLock(timeout = 5000) {
    const startTime = Date.now();
    
    while (isExcelFileLocked) {
        if (Date.now() - startTime > timeout) {
            throw new Error('Timeout waiting for Excel file access');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    isExcelFileLocked = true;
}

// Function to release lock
function releaseLock() {
    isExcelFileLocked = false;
    if (pendingWrites.length > 0) {
        const nextWrite = pendingWrites.shift();
        nextWrite();
    }
}

// Function to update Excel file with retry mechanism
async function updateExcelFile(newData) {
    const filePath = process.env.EXCEL_FILE || 'uploads/reservations.xlsx';
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            await acquireLock();
            
            let workbook;
            let existingData = [];

            // Check if file exists
            if (fsSync.existsSync(filePath)) {
                console.log('Reading existing Excel file');
                workbook = XLSX.readFile(filePath);
                if (workbook.Sheets['Reservations']) {
                    existingData = XLSX.utils.sheet_to_json(workbook.Sheets['Reservations']);
                }
            } else {
                console.log('Creating new Excel file');
                workbook = XLSX.utils.book_new();
            }

            // Add new data with unique ID
            const dataWithId = {
                ...newData,
                id: uuidv4(),
                submissionDate: new Date().toISOString()
            };
            existingData.push(dataWithId);

            // Create worksheet
            const worksheet = createStyledWorksheet(existingData);

            // Remove existing worksheet if it exists
            if (workbook.Sheets['Reservations']) {
                delete workbook.Sheets['Reservations'];
                const idx = workbook.SheetNames.indexOf('Reservations');
                if (idx !== -1) {
                    workbook.SheetNames.splice(idx, 1);
                }
            }

            // Add the worksheet to the workbook
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Reservations');
            
            // Save to a temporary file first
            const tempFilePath = `${filePath}.temp.xlsx`;
            await XLSX.writeFile(workbook, tempFilePath);
            
            // Rename temp file to actual file (atomic operation)
            if (fsSync.existsSync(filePath)) {
                await fs.unlink(filePath); // Delete existing file if it exists
            }
            await fs.rename(tempFilePath, filePath);
            
            console.log('Excel file updated successfully');
            return dataWithId;

        } catch (error) {
            attempt++;
            console.error(`Error updating Excel file (attempt ${attempt}/${maxRetries}):`, error);
            
            // Clean up temp file if it exists
            const tempFilePath = `${filePath}.temp.xlsx`;
            if (fsSync.existsSync(tempFilePath)) {
                try {
                    await fs.unlink(tempFilePath);
                } catch (cleanupError) {
                    console.error('Error cleaning up temp file:', cleanupError);
                }
            }

            if (attempt === maxRetries) {
                throw new Error('Failed to update reservation data after multiple attempts');
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } finally {
            releaseLock();
        }
    }
}

// Create a styled worksheet function
function createStyledWorksheet(data) {
    const formatDateForExcel = (dateString) => {
        try {
            const date = new Date(dateString);
            return date.toLocaleString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            console.error('Error formatting date:', error);
            return dateString;
        }
    };

    // Define columns with their properties
    const columns = [
        { header: 'Submission Date', key: 'submissionDate', width: 20 },
        { header: 'First Name', key: 'firstName', width: 15 },
        { header: 'Last Name', key: 'lastName', width: 15 },
        { header: 'Birthday', key: 'birthday', width: 12 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Address', key: 'address', width: 30 },
        { header: 'Neighbourhood', key: 'neighbourhood', width: 20 },
        { header: 'Budget (fr)', key: 'budget', width: 12 },
        { header: 'Pickup Date', key: 'pickupDate', width: 20 },
        { header: 'Return Date', key: 'returnDate', width: 20 },
        { header: 'Pickup Location', key: 'pickupLocation', width: 15 },
        { header: 'Specific Location', key: 'specificLocation', width: 30 },
        { header: 'Passport File', key: 'passportFile', width: 30 },
        { header: 'License File', key: 'licenseFile', width: 30 },
        { header: 'Reservation ID', key: 'id', width: 40 }
    ];

    // Format dates in the data
    const formattedData = data.map(row => ({
        ...row,
        submissionDate: formatDateForExcel(row.submissionDate),
        birthday: formatDateForExcel(row.birthday),
        pickupDate: formatDateForExcel(row.pickupDate),
        returnDate: formatDateForExcel(row.returnDate),
        budget: `${row.budget} fr`
    }));

    // Create worksheet from data
    const worksheet = XLSX.utils.json_to_sheet(formattedData, {
        header: columns.map(col => col.key)
    });

    // Set column widths
    worksheet['!cols'] = columns.map(col => ({ width: col.width }));

    // Add headers
    const headerRow = {};
    columns.forEach(col => {
        headerRow[col.key] = col.header;
    });
    XLSX.utils.sheet_add_json(worksheet, [headerRow], { skipHeader: true, origin: 'A1' });

    // Style the worksheet
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let row = range.s.r; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (!worksheet[cellRef]) continue;

            worksheet[cellRef].s = {
                font: { name: 'Arial', sz: 11 },
                alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
                border: {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                }
            };

            // Style headers
            if (row === 0) {
                worksheet[cellRef].s.font.bold = true;
                worksheet[cellRef].s.fill = { fgColor: { rgb: 'EFEFEF' } };
                worksheet[cellRef].s.alignment.horizontal = 'center';
            }
        }
    }

    return worksheet;
}

// Handle form submission with queue
app.post('/submit', upload.fields([
    { name: 'passport', maxCount: 1 },
    { name: 'license', maxCount: 1 }
]), async (req, res) => {
    try {
        // Validate files
        if (!req.files || !req.files.passport || !req.files.license) {
            return res.status(400).json({ 
                success: false, 
                message: 'Both passport and license files are required' 
            });
        }

        // Process form data
        const formData = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            birthday: req.body.birthday,
            phone: req.body.phone,
            address: req.body.address,
            neighbourhood: req.body.neighbourhood,
            budget: req.body.budget,
            pickupDate: req.body.pickupDate,
            returnDate: req.body.returnDate,
            pickupLocation: req.body.pickupLocation,
            specificLocation: req.body.specificLocation || '',
            passportFile: req.files.passport[0].filename,
            licenseFile: req.files.license[0].filename
        };

        // Add to Excel file with queuing
        const savedData = await new Promise((resolve, reject) => {
            const processWrite = async () => {
                try {
                    const result = await updateExcelFile(formData);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            if (isExcelFileLocked) {
                pendingWrites.push(processWrite);
            } else {
                processWrite();
            }
        });

        res.json({ 
            success: true, 
            message: 'Reservation submitted successfully',
            reservationId: savedData.id
        });

    } catch (error) {
        console.error('Error processing submission:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Error processing your request'
        });
    }
});

// Serve static files from the uploads directory
app.use('/uploads', express.static('uploads'));

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
    const adminKey = process.env.ADMIN_KEY || 'CarRental269@';
    const providedKey = req.query.key;

    if (!providedKey || providedKey !== adminKey) {
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Invalid or missing admin key' 
        });
    }
    next();
};

// Download Excel file endpoint
app.get('/download-reservations', authenticateAdmin, (req, res) => {
    const filePath = process.env.EXCEL_FILE || 'uploads/reservations.xlsx';
    
    try {
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'No reservations file exists yet'
            });
        }

        const fileName = `reservations-${new Date().toISOString().split('T')[0]}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Error downloading reservations file'
        });
    }
});

// List all reservations endpoint
app.get('/list-reservations', authenticateAdmin, (req, res) => {
    const filePath = process.env.EXCEL_FILE || 'uploads/reservations.xlsx';
    
    try {
        if (!fsSync.existsSync(filePath)) {
            return res.json({ reservations: [] });
        }

        const workbook = XLSX.readFile(filePath);
        const worksheet = workbook.Sheets['Reservations'];
        const reservations = XLSX.utils.sheet_to_json(worksheet);

        res.json({ 
            total: reservations.length,
            reservations: reservations
        });
    } catch (error) {
        console.error('Error reading reservations:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Error reading reservations'
        });
    }
});

// Error handling for 404
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found on this server',
        path: req.path
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' 
            ? 'An internal server error occurred' 
            : err.message
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
