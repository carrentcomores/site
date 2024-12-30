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

// Function to update Excel file
async function updateExcelFile(newData) {
    const filePath = process.env.EXCEL_FILE || 'reservations.xlsx';
    console.log('Using Excel file path:', filePath);
    
    let workbook;
    let existingData = [];

    try {
        // Ensure the uploads directory exists
        const uploadsDir = process.env.UPLOAD_DIR || 'uploads';
        if (!fsSync.existsSync(uploadsDir)) {
            console.log('Creating uploads directory:', uploadsDir);
            fsSync.mkdirSync(uploadsDir, { recursive: true });
        }

        // Check if file exists and read existing data
        if (fsSync.existsSync(filePath)) {
            console.log('Reading existing Excel file');
            try {
                workbook = XLSX.readFile(filePath);
                if (workbook.Sheets['Reservations']) {
                    existingData = XLSX.utils.sheet_to_json(workbook.Sheets['Reservations']);
                    console.log('Found existing reservations:', existingData.length);
                } else {
                    console.log('No Reservations sheet found in existing file');
                }
            } catch (readError) {
                console.error('Error reading existing file:', readError);
                // If there's an error reading the file, create a new one
                console.log('Creating new workbook due to read error');
                workbook = XLSX.utils.book_new();
            }
        } else {
            console.log('Excel file does not exist, creating new workbook');
            workbook = XLSX.utils.book_new();
        }

        // Format the new data
        const formattedNewData = {
            submissionDate: new Date().toISOString(),
            firstName: newData.firstName,
            lastName: newData.lastName,
            birthday: newData.birthday,
            phone: newData.phone,
            address: newData.address,
            neighbourhood: newData.neighbourhood,
            budget: newData.budget,
            pickupDate: newData.pickupDate,
            returnDate: newData.returnDate,
            pickupLocation: newData.pickupLocation,
            specificLocation: newData.specificLocation || '',
            passportFile: newData.passportFile,
            licenseFile: newData.licenseFile
        };

        // Add new data to existing data
        existingData.push(formattedNewData);
        console.log('Added new reservation to dataset');

        // Create a new worksheet with the updated data
        const worksheet = XLSX.utils.json_to_sheet(existingData);
        console.log('Created new worksheet');

        // Set column widths
        worksheet['!cols'] = [
            { wch: 20 }, // Submission Date
            { wch: 15 }, // First Name
            { wch: 15 }, // Last Name
            { wch: 12 }, // Birthday
            { wch: 15 }, // Phone
            { wch: 30 }, // Address
            { wch: 20 }, // Neighbourhood
            { wch: 12 }, // Budget
            { wch: 20 }, // Pickup Date
            { wch: 20 }, // Return Date
            { wch: 15 }, // Pickup Location
            { wch: 30 }, // Specific Location
            { wch: 30 }, // Passport File
            { wch: 30 }  // License File
        ];

        // Remove existing sheet if it exists
        const sheetName = 'Reservations';
        if (workbook.Sheets[sheetName]) {
            delete workbook.Sheets[sheetName];
            const idx = workbook.SheetNames.indexOf(sheetName);
            if (idx !== -1) {
                workbook.SheetNames.splice(idx, 1);
            }
        }

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        console.log('Added worksheet to workbook');

        // Save directly to the file
        try {
            XLSX.writeFile(workbook, filePath);
            console.log('Successfully wrote Excel file');
        } catch (writeError) {
            console.error('Error writing Excel file:', writeError);
            throw writeError;
        }

    } catch (error) {
        console.error('Error in updateExcelFile:', error);
        throw new Error(`Failed to update reservation data: ${error.message}`);
    }
}

// Handle form submission
app.post('/submit', upload.fields([
    { name: 'passport', maxCount: 1 },
    { name: 'license', maxCount: 1 }
]), async (req, res) => {
    console.log('Received form submission');
    try {
        // Validate files
        if (!req.files || !req.files.passport || !req.files.license) {
            console.error('Missing required files');
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

        // Validate and format form data
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

        console.log('Validated form data:', formData);

        // Update Excel file
        await updateExcelFile(formData);
        console.log('Successfully updated Excel file');
        
        res.json({ 
            success: true, 
            message: 'Reservation submitted successfully'
        });

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