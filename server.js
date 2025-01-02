// Load environment variables
require('dotenv').config();

// Constants and Configuration
const DEFAULT_ADMIN_KEY = process.env.ADMIN_KEY || 'CarRental269@';
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const EXCEL_FILE = process.env.EXCEL_FILE || 'uploads/reservations.xlsx';
const PORT = process.env.PORT || 3000;

// Express setup
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://carrentcomores-reservation-api.onrender.com']
        : '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false
}));
app.use(bodyParser.json()); // Parse JSON bodies

// Serve static files - order matters!
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Initialize uploads directory
if (!fsSync.existsSync(UPLOAD_DIR)) {
    fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log('Created uploads directory:', UPLOAD_DIR);
}

// Ensure Excel file directory exists
const excelFilePath = path.join(UPLOAD_DIR, EXCEL_FILE);
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
        try {
            await fs.mkdir(UPLOAD_DIR, { recursive: true });
            cb(null, UPLOAD_DIR);
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

// Function to get Excel file path
const getExcelFilePath = () => {
    // If EXCEL_FILE is an absolute path, use it directly
    if (path.isAbsolute(EXCEL_FILE)) {
        return EXCEL_FILE;
    }
    // Otherwise, resolve it relative to the project root
    return path.join(__dirname, EXCEL_FILE);
};

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
    console.log('Auth request received');
    const adminKey = process.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
    // Check for key in query params or request body
    const providedKey = req.query.key || (req.body && req.body.key);

    console.log('Authenticating with key:', providedKey);
    
    if (!providedKey || providedKey !== adminKey) {
        console.log('Authentication failed - Invalid key');
        return res.status(401).json({
            success: false,
            message: 'Invalid admin key'
        });
    }

    console.log('Authentication successful');
    next();
};

// Admin Routes - place these before the catch-all route
app.get('/dashboard', (req, res) => {
    console.log('Serving dashboard.html');
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/auth-check', authenticateAdmin, (req, res) => {
    res.json({ success: true });
});

app.get('/list-reservations', authenticateAdmin, (req, res) => {
    const filePath = getExcelFilePath();
    console.log('Reading reservations from:', filePath);

    try {
        if (!fsSync.existsSync(filePath)) {
            console.log('No reservations file exists at:', filePath);
            return res.json({
                success: true,
                total: 0,
                reservations: []
            });
        }

        const workbook = XLSX.readFile(filePath);
        const sheetName = 'Reservations';

        if (!workbook.Sheets[sheetName]) {
            console.log('No Reservations sheet found in workbook');
            return res.json({
                success: true,
                total: 0,
                reservations: []
            });
        }

        const reservations = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        console.log(`Found ${reservations.length} reservations`);

        res.json({
            success: true,
            total: reservations.length,
            reservations: reservations
        });

    } catch (error) {
        console.error('Error reading reservations:', error);
        res.status(500).json({
            success: false,
            message: 'Error reading reservations: ' + error.message
        });
    }
});

// Update reservation status endpoint
app.post('/update-status', authenticateAdmin, async (req, res) => {
    const { id, status } = req.body;
    console.log('Updating status for reservation:', id, 'to:', status);

    try {
        const filePath = getExcelFilePath();
        if (!fsSync.existsSync(filePath)) {
            throw new Error('Reservations file not found');
        }

        const workbook = XLSX.readFile(filePath);
        const sheetName = 'Reservations';
        
        if (!workbook.Sheets[sheetName]) {
            throw new Error('Reservations sheet not found');
        }

        // Convert sheet to JSON
        let reservations = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        console.log('Total reservations:', reservations.length);
        
        // Find the reservation by submission date and name since we don't have IDs
        const reservationIndex = reservations.findIndex(r => {
            // Convert the generated ID back to the original format
            const submissionDate = r.submissionDate ? new Date(r.submissionDate).getTime() : '';
            const firstName = r.firstName || '';
            const generatedId = `${submissionDate}-${firstName}`.toLowerCase();
            
            console.log('Comparing IDs:', {
                generatedId,
                providedId: id,
                match: generatedId === id.toLowerCase()
            });
            
            return generatedId === id.toLowerCase();
        });

        if (reservationIndex === -1) {
            console.log('Reservation not found. Available reservations:', reservations);
            throw new Error('Reservation not found');
        }

        // Update the status
        reservations[reservationIndex].status = status;
        console.log('Updated reservation:', reservations[reservationIndex]);

        // Convert back to sheet
        const newSheet = XLSX.utils.json_to_sheet(reservations);
        workbook.Sheets[sheetName] = newSheet;

        // Write back to file
        XLSX.writeFile(workbook, filePath);

        console.log('Status updated successfully');
        res.json({ 
            success: true, 
            message: 'Status updated successfully' 
        });

    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating status: ' + error.message 
        });
    }
});

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all route for SPA - must be after all other routes
app.get('*', (req, res) => {
    console.log('Catch-all route hit:', req.path);
    // If the request is for the dashboard path, serve dashboard.html
    if (req.path === '/dashboard') {
        console.log('Serving dashboard from catch-all');
        return res.sendFile(path.join(__dirname, 'dashboard.html'));
    }
    // Otherwise, serve index.html
    res.sendFile(path.join(__dirname, 'index.html'));
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
    const filePath = getExcelFilePath();
    console.log('Using Excel file path:', filePath);
    
    let workbook;
    let existingData = [];

    try {
        // Ensure the uploads directory exists
        if (!fsSync.existsSync(UPLOAD_DIR)) {
            console.log('Creating uploads directory:', UPLOAD_DIR);
            fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
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

// Download Excel file endpoint
app.get('/download-reservations', authenticateAdmin, (req, res) => {
    const filePath = getExcelFilePath();
    
    try {
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'No reservations file exists yet'
            });
        }

        const fileBuffer = fsSync.readFileSync(filePath);
        const fileName = `reservations-${new Date().toISOString().split('T')[0]}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', fileBuffer.length);
        
        res.send(fileBuffer);

    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Error downloading reservations file'
        });
    }
});

// API endpoint to save client data
app.post('/api/saveClientData', (req, res) => {
    const clientData = req.body; // Get client data from request body

    // TODO: Save clientData to your database
    console.log('Received client data:', clientData);

    // Respond with a success message
    res.status(200).json({ message: 'Client data saved successfully!' });
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

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});