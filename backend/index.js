const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());

// Path to the JSON file for data storage
const dataFilePath = path.join(__dirname, 'rentalData.json');

// Endpoint to save rental data
app.post('/api/rentals', (req, res) => {
    console.log('Received rental data:', req.body); // Log incoming data
    const rentalData = req.body;
    fs.readFile(dataFilePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading data file.');
        }
        const rentals = data ? JSON.parse(data) : [];
        rentals.push(rentalData);
        fs.writeFile(dataFilePath, JSON.stringify(rentals, null, 2), (err) => {
            if (err) {
                return res.status(500).send('Error saving data.');
            }
            console.log('Rental data saved successfully.'); // Log success
            res.status(201).send('Rental data saved successfully.');
        });
    });
});

// Endpoint to retrieve rental data
app.get('/api/rentals', (req, res) => {
    fs.readFile(dataFilePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading data file.');
        }
        res.status(200).send(data ? JSON.parse(data) : []);
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
