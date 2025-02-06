# Madrid Events

## Project Description

Madrid Events is a web application designed to explore and manage events in Madrid. The platform allows users to discover a variety of local events, including their location, date, time, and relevant details. Users can navigate through different event categories, view detailed information, and check availability.

Main features:
- Event listing with detailed information
- Event filtering by categories
- Event search functionality
- Detailed event specifics
- Responsive and user-friendly interface

## Prerequisites

- Node.js (v18+)
- npm or yarn
- MongoDB installed and configured

## Installation

### Clone Repository
```bash
git clone https://github.com/[your-username]/madrid-events.git
cd madrid-events
```

### Install Dependencies
```bash
# Install backend
cd backend
npm install

# Install frontend
cd ../frontend
npm install
```

### Environment Configuration

#### Backend Environment Variables
Create a `.env` file in the backend directory with the following configuration:
```
# Database Configuration
MONGO_URI=mongodb://[username]:[password]@[host]:[port]/
DB_NAME=madrid-events
COLLECTION_NAME=events
PORT=5000
FRONTEND_URL=http://localhost:3000,http://localhost:3000/
NODE_ENV=development
```

#### Frontend Environment Variables
Create a `.env` file in the frontend directory with the following configuration:
```
NEXT_PUBLIC_API_HOST=http://localhost
NEXT_PUBLIC_API_PORT=5000
```

### MongoDB Configuration

Ensure MongoDB is installed and running. The application requires a MongoDB instance. You can install MongoDB following the official instructions for your operating system.

## Running Scripts

### Backend
```bash
cd backend
npm run dev  # Development mode
npm start    # Production mode
```

### Frontend
```bash
cd frontend
npm start    # Start development server
npm run build # Build for production
```

## Screenshots

### Main Dashboard
![Main Dashboard](images/_1.png)

### Map View
![Map View](images/_3.png)