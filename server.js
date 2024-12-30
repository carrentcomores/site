const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'];

// Enable CORS with specific origin
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['POST'],
    credentials: true
}));

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

// Create a styled worksheet
function createStyledWorksheet(data) {
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

    const worksheet = XLSX.utils.json_to_sheet(data);

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
                
                // Format dates
                if (['submissionDate', 'pickupDate', 'returnDate', 'birthday'].includes(columns[col].key)) {
                    try {
                        const date = new Date(worksheet[cellRef].v);
                        worksheet[cellRef].v = date.toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    } catch (e) {
                        // Keep original value if date parsing fails
                    }
                }
                
                // Format budget
                if (columns[col].key === 'budget') {
                    worksheet[cellRef].v = `${worksheet[cellRef].v} fr`;
                }
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'An internal server error occurred' 
            : err.message
    });
});

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

        const formData = {
            ...req.body,
            submissionDate: new Date().toISOString(),
            passportFile: req.files.passport[0].filename,
            licenseFile: req.files.license[0].filename
        };

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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
