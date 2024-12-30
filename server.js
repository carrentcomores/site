const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all origins during development
app.use(cors({
    origin: '*', // Allow all origins temporarily
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false // Changed to false since we're using '*'
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
    destination: function (req, file, cb) {
        const uploadDir = process.env.UPLOAD_DIR || 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Sanitize filename
        const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${Date.now()}-${sanitizedFilename}`);
    }
});

const fileFilter = (req, file, cb) => {
    // Accept only specific file types
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
        fileSize: 5 * 1024 * 1024 // 5MB limit
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

// Function to update Excel file
async function updateExcelFile(newData) {
    const filePath = process.env.EXCEL_FILE || 'reservations.xlsx';
    let workbook;
    let existingData = [];

    try {
        // Check if file exists
        if (fs.existsSync(filePath)) {
            console.log('Reading existing Excel file');
            workbook = XLSX.readFile(filePath);
            if (workbook.Sheets['Reservations']) {
                existingData = XLSX.utils.sheet_to_json(workbook.Sheets['Reservations']);
            }
        } else {
            console.log('Creating new Excel file');
            workbook = XLSX.utils.book_new();
        }

        // Add new data to existing data
        existingData.push(newData);
        console.log('Adding new reservation:', newData);

        // Create a new worksheet with the updated data
        const worksheet = createStyledWorksheet(existingData);

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Reservations');

        // Ensure the uploads directory exists
        const uploadsDir = process.env.UPLOAD_DIR || 'uploads';
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // Save the workbook
        console.log('Saving Excel file to:', filePath);
        XLSX.writeFile(workbook, filePath);
        console.log('Excel file updated successfully');

    } catch (error) {
        console.error('Error updating Excel file:', error);
        throw new Error('Failed to update reservation data');
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
        { header: 'License File', key: 'licenseFile', width: 30 }
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
    const colWidths = {};
    columns.forEach(col => {
        colWidths[col.key] = { width: col.width };
    });
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
                alignment: { vertical: 'center', horizontal: 'left' },
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
            }
        }
    }

    return worksheet;
}

// Handle form submission
app.post('/submit', upload.fields([
    { name: 'passport', maxCount: 1 },
    { name: 'license', maxCount: 1 }
]), async (req, res) => {
    try {
        // Log incoming request data for debugging
        console.log('Received form data:', req.body);
        console.log('Received files:', req.files);

        if (!req.files || !req.files.passport || !req.files.license) {
            return res.status(400).json({ 
                success: false, 
                message: 'Both passport and license files are required' 
            });
        }

        // Basic data validation
        const validateField = (field, name) => {
            if (!field || field.trim() === '') {
                throw new Error(`${name} is required`);
            }
            return field.trim();
        };

        const formData = {
            firstName: validateField(req.body.firstName, 'First name'),
            lastName: validateField(req.body.lastName, 'Last name'),
            phone: validateField(req.body.phone, 'Phone number'),
            address: validateField(req.body.address, 'Address'),
            neighbourhood: validateField(req.body.neighbourhood, 'Neighbourhood'),
            budget: validateField(req.body.budget, 'Budget'),
            pickupLocation: validateField(req.body.pickupLocation, 'Pickup location'),
            specificLocation: req.body.specificLocation || '',
            passportFile: req.files.passport[0].filename,
            licenseFile: req.files.license[0].filename
        };

        // Date validation and formatting
        const validateDate = (dateString, fieldName) => {
            try {
                const date = new Date(dateString);
                if (isNaN(date.getTime())) {
                    throw new Error(`Invalid ${fieldName}`);
                }
                return date.toISOString();
            } catch (error) {
                throw new Error(`Invalid ${fieldName}`);
            }
        };

        formData.birthday = validateDate(req.body.birthday, 'birthday');
        formData.pickupDate = validateDate(req.body.pickupDate, 'pickup date');
        formData.returnDate = validateDate(req.body.returnDate, 'return date');
        formData.submissionDate = new Date().toISOString();

        // Additional date validations
        const pickup = new Date(formData.pickupDate);
        const returnDate = new Date(formData.returnDate);
        const now = new Date();

        if (pickup < now) {
            throw new Error('Pickup date cannot be in the past');
        }

        if (returnDate < pickup) {
            throw new Error('Return date must be after pickup date');
        }

        console.log('Processed form data:', formData);

        await updateExcelFile(formData);
        res.json({ success: true, message: 'Data saved successfully' });
    } catch (error) {
        console.error('Error processing submission:', error);
        res.status(400).json({ 
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
    const filePath = process.env.EXCEL_FILE || 'reservations.xlsx';
    
    try {
        if (!fs.existsSync(filePath)) {
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
    const filePath = process.env.EXCEL_FILE || 'reservations.xlsx';
    
    try {
        if (!fs.existsSync(filePath)) {
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
