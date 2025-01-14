# Car Reservation System

A web-based car reservation system that collects user information and stores it in an Excel file.

## Features

- User-friendly reservation form
- File upload support for passport and license
- Excel file storage with styled formatting
- Responsive design
- Production-ready security features

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn

## Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment

### Option 1: Deploy to Render.com

1. Create a new account on [Render.com](https://render.com)
2. Create a new Web Service
3. Connect your GitHub repository
4. Configure the following:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables: Copy from `.env.example`

### Option 2: Deploy to Railway.app

1. Create a new account on [Railway.app](https://railway.app)
2. Create a new project
3. Connect your GitHub repository
4. Add environment variables from `.env.example`
5. Deploy

### Option 3: Deploy to Heroku

1. Install Heroku CLI
2. Login to Heroku:
   ```bash
   heroku login
   ```
3. Create a new Heroku app:
   ```bash
   heroku create your-app-name
   ```
4. Set environment variables:
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set ALLOWED_ORIGINS=https://carrentcomores.site
   ```
5. Deploy:
   ```bash
   git push heroku main
   ```

## Frontend Integration

After deploying the backend, update the API_URL in your frontend code:

1. Open `index.html`
2. Update the API_URL constant:
   ```javascript
   const API_URL = 'https://carrentcomores-reservation-api.onrender.com';
   ```

## Security Features

- CORS protection
- File upload restrictions
- Security headers
- Input sanitization
- Error handling
- Rate limiting (coming soon)

## File Storage

By default, files are stored locally. For production, consider using cloud storage solutions:

- AWS S3
- Google Cloud Storage
- Azure Blob Storage

## Maintenance

- Regularly backup the Excel file
- Monitor disk space for uploads
- Check server logs for errors
- Update dependencies regularly

## License

MIT
# site
# site
# site
# site
# site
# site
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
# booking
