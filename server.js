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

// Create a styled worksheet
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

    // Format dates before creating worksheet
    const formattedData = data.map(row => ({
        ...row,
        submissionDate: formatDateForExcel(row.submissionDate),
        birthday: formatDateForExcel(row.birthday),
        pickupDate: formatDateForExcel(row.pickupDate),
        returnDate: formatDateForExcel(row.returnDate)
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);

    // Style configuration
    const headerStyle = {
        fill: { fgColor: { rgb: "4F81BD" } },
        font: { color: { rgb: "FFFFFF" }, bold: true },
        alignment: { horizontal: "center" },
        border: {
            top: { style: "thin" },
            bottom: { style: "thin" },
            left: { style: "thin" },
            right: { style: "thin" }
        }
    };

    const cellStyle = {
        border: {
            top: { style: "thin" },
            bottom: { style: "thin" },
            left: { style: "thin" },
            right: { style: "thin" }
        },
        alignment: { horizontal: "left", wrapText: true }
    };

    // Set column widths
    const colWidths = columns.map(col => ({ wch: col.width }));
    worksheet['!cols'] = colWidths;

    // Apply styles to cells
    for (let row = 0; row <= data.length; row++) {
        for (let col = 0; col < columns.length; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (!worksheet[cellRef]) continue;
            
            if (row === 0) {
                worksheet[cellRef].s = headerStyle;
            } else {
                worksheet[cellRef].s = cellStyle;
            }
        }
    }

    // Apply alternating row colors
    for (let row = 1; row <= data.length; row++) {
        const rowStyle = row % 2 === 0 ? { fill: { fgColor: { rgb: "F2F2F2" } } } : {};
        for (let col = 0; col < columns.length; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (worksheet[cellRef]) {
                worksheet[cellRef].s = { ...worksheet[cellRef].s, ...rowStyle };
            }
        }
    }

    return worksheet;
}

// Function to update Excel file
function updateExcelFile(newData) {
    const filePath = process.env.EXCEL_FILE || 'reservations.xlsx';
    let workbook;
    let existingData = [];

    try {
        if (fs.existsSync(filePath)) {
            workbook = XLSX.readFile(filePath);
            existingData = XLSX.utils.sheet_to_json(workbook.Sheets['Reservations']);
        } else {
            workbook = XLSX.utils.book_new();
        }

        existingData.push(newData);
        const worksheet = createStyledWorksheet(existingData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Reservations', true);
        XLSX.writeFile(workbook, filePath);
        
        return true;
    } catch (error) {
        console.error('Error updating Excel file:', error);
        throw new Error('Failed to update Excel file');
    }
}

// Handle form submission
app.post('/submit', upload.fields([
    { name: 'passport', maxCount: 1 },
    { name: 'license', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.passport || !req.files.license) {
            return res.status(400).json({ 
                success: false, 
                message: 'Both passport and license files are required' 
            });
        }

        // Format dates properly
        const formatDate = (dateString) => {
            try {
                const date = new Date(dateString);
                if (isNaN(date.getTime())) {
                    throw new Error('Invalid date');
                }
                return date.toISOString();
            } catch (error) {
                console.error('Date parsing error:', error);
                return null;
            }
        };

        const formData = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            birthday: formatDate(req.body.birthday),
            phone: req.body.phone,
            address: req.body.address,
            neighbourhood: req.body.neighbourhood,
            budget: req.body.budget,
            pickupDate: formatDate(req.body.pickupDate),
            returnDate: formatDate(req.body.returnDate),
            pickupLocation: req.body.pickupLocation,
            specificLocation: req.body.specificLocation || '',
            submissionDate: new Date().toISOString(),
            passportFile: req.files.passport[0].filename,
            licenseFile: req.files.license[0].filename
        };

        // Validate all required fields
        const requiredFields = ['firstName', 'lastName', 'birthday', 'phone', 'address', 
                              'neighbourhood', 'budget', 'pickupDate', 'returnDate', 'pickupLocation'];
        
        for (const field of requiredFields) {
            if (!formData[field]) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid or missing ${field}`
                });
            }
        }

        await updateExcelFile(formData);
        res.json({ success: true, message: 'Data saved successfully' });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ 
            success: false, 
            message: process.env.NODE_ENV === 'production'
                ? 'Error processing your request'
                : error.message
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
