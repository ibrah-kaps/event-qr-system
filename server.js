const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// IMPORTANT: Serve static files (this makes admin.html work)
app.use(express.static(__dirname));

// Aiven MySQL Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'mysql-22413e97-korirabraham6371-59b6.l.aivencloud.com',
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD, // No hardcoded password!
    database: process.env.DB_NAME || 'defaultdb',
    port: process.env.DB_PORT || 23164,
    ssl: {
        rejectUnauthorized: false
    }
});

db.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed:', err);
        console.error('Please check:');
        console.error('1. Aiven MySQL is running');
        console.error('2. Password is correct in environment variables');
        console.error('3. Database exists');
        return;
    }
    console.log('✅ Connected to Aiven MySQL database');
    
    // Check and add phone column
    db.query(`SHOW COLUMNS FROM guests LIKE 'phone'`, (err, result) => {
        if (result && result.length === 0) {
            db.query(`ALTER TABLE guests ADD COLUMN phone VARCHAR(20)`);
            console.log('✅ Added phone column');
        }
    });
    
    // Check and add card_design column
    db.query(`SHOW COLUMNS FROM events LIKE 'card_design'`, (err, result) => {
        if (result && result.length === 0) {
            db.query(`ALTER TABLE events ADD COLUMN card_design VARCHAR(50) DEFAULT 'party'`);
            console.log('✅ Added card_design column');
        }
    });
    
    // Check and add table_number column
    db.query(`SHOW COLUMNS FROM guests LIKE 'table_number'`, (err, result) => {
        if (result && result.length === 0) {
            db.query(`ALTER TABLE guests ADD COLUMN table_number VARCHAR(50)`);
            console.log('✅ Added table_number column');
        }
    });
    
    // Check and add email column if not exists
    db.query(`SHOW COLUMNS FROM guests LIKE 'email'`, (err, result) => {
        if (result && result.length === 0) {
            db.query(`ALTER TABLE guests ADD COLUMN email VARCHAR(255)`);
            console.log('✅ Added email column');
        }
    });
    
    // Create tables if they don't exist
    const createEventsTable = `
        CREATE TABLE IF NOT EXISTS events (
            id INT PRIMARY KEY AUTO_INCREMENT,
            event_name VARCHAR(255) NOT NULL,
            event_date DATE,
            event_time TIME,
            venue VARCHAR(255),
            card_design VARCHAR(50) DEFAULT 'party',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;
    
    const createGuestsTable = `
        CREATE TABLE IF NOT EXISTS guests (
            id INT PRIMARY KEY AUTO_INCREMENT,
            event_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            phone VARCHAR(20),
            table_number VARCHAR(50),
            unique_code VARCHAR(100) UNIQUE NOT NULL,
            checked_in BOOLEAN DEFAULT FALSE,
            check_in_time DATETIME,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        )
    `;
    
    db.query(createEventsTable, (err) => {
        if (err) console.error('Error creating events table:', err);
        else console.log('✅ Events table ready');
    });
    
    db.query(createGuestsTable, (err) => {
        if (err) console.error('Error creating guests table:', err);
        else console.log('✅ Guests table ready');
    });
    
    console.log('✅ All database tables are ready');
});

// ==================== API ROUTES ====================

// Home route
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        message: '🎉 Event Management System API is running!',
        timestamp: new Date().toISOString(),
        designs: ['wedding', 'birthday', 'graduation', 'anniversary', 'corporate', 'party'],
        endpoints: {
            createEvent: 'POST /api/events',
            listEvents: 'GET /api/events',
            getEvent: 'GET /api/events/:id',
            deleteEvent: 'DELETE /api/events/:id',
            addGuest: 'POST /api/guests',
            listGuests: 'GET /api/guests/event/:eventId',
            assignTable: 'POST /api/guests/:id/table',
            tableLayout: 'GET /api/tables/event/:eventId',
            exportGuests: 'GET /api/export/guests/:eventId',
            stats: 'GET /api/stats',
            invitation: 'GET /invite/:code',
            scan: 'GET /scan/:code'
        }
    });
});

// Get statistics
app.get('/api/stats', (req, res) => {
    let stats = {
        totalEvents: 0,
        totalGuests: 0,
        checkedIn: 0
    };
    
    db.query('SELECT COUNT(*) as count FROM events', (err, eventsResult) => {
        if (!err && eventsResult.length > 0) {
            stats.totalEvents = eventsResult[0].count;
        }
        
        db.query('SELECT COUNT(*) as count FROM guests', (err, guestsResult) => {
            if (!err && guestsResult.length > 0) {
                stats.totalGuests = guestsResult[0].count;
            }
            
            db.query('SELECT COUNT(*) as count FROM guests WHERE checked_in = true', (err, checkedResult) => {
                if (!err && checkedResult.length > 0) {
                    stats.checkedIn = checkedResult[0].count;
                }
                res.json(stats);
            });
        });
    });
});

// ==================== EVENT ROUTES ====================

// Create new event
app.post('/api/events', (req, res) => {
    const { event_name, event_date, event_time, venue, card_design } = req.body;
    
    if (!event_name) {
        return res.status(400).json({ error: 'Event name is required' });
    }
    
    const design = card_design || 'party';
    
    const sql = 'INSERT INTO events (event_name, event_date, event_time, venue, card_design) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [event_name, event_date, event_time, venue, design], (err, result) => {
        if (err) {
            console.error('Error creating event:', err);
            res.status(500).json({ error: err.message });
        } else {
            res.status(201).json({ 
                message: 'Event created successfully', 
                eventId: result.insertId 
            });
        }
    });
});

// Get all events
app.get('/api/events', (req, res) => {
    db.query('SELECT * FROM events ORDER BY created_at DESC', (err, results) => {
        if (err) {
            console.error('Error fetching events:', err);
            res.status(500).json({ error: err.message });
        } else {
            res.json(results);
        }
    });
});

// Get single event
app.get('/api/events/:id', (req, res) => {
    db.query('SELECT * FROM events WHERE id = ?', [req.params.id], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (results.length === 0) {
            res.status(404).json({ error: 'Event not found' });
        } else {
            res.json(results[0]);
        }
    });
});

// Delete event
app.delete('/api/events/:id', (req, res) => {
    db.query('DELETE FROM events WHERE id = ?', [req.params.id], (err, result) => {
        if (err) {
            console.error('Error deleting event:', err);
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'Event deleted successfully' });
        }
    });
});

// ==================== GUEST ROUTES ====================

// Add guest to event
app.post('/api/guests', (req, res) => {
    const { event_id, name, email, phone, table_number } = req.body;
    
    if (!event_id || !name) {
        return res.status(400).json({ error: 'Event ID and name are required' });
    }
    
    const unique_code = uuidv4();
    
    const sql = 'INSERT INTO guests (event_id, name, email, phone, table_number, unique_code) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [event_id, name, email || null, phone || null, table_number || null, unique_code], (err, result) => {
        if (err) {
            console.error('Error adding guest:', err);
            res.status(500).json({ error: err.message });
        } else {
            const inviteLink = `https://event-qr-system-7vgo.onrender.com/invite/${unique_code}`;
            const scanLink = `https://event-qr-system-7vgo.onrender.com/scan/${unique_code}`;
            
            QRCode.toDataURL(inviteLink, (err, qrCodeUrl) => {
                res.status(201).json({
                    message: 'Guest added successfully',
                    guestId: result.insertId,
                    unique_code: unique_code,
                    inviteLink: inviteLink,
                    scanLink: scanLink,
                    qrCode: qrCodeUrl || null
                });
            });
        }
    });
});

// Get guests for event
app.get('/api/guests/event/:eventId', (req, res) => {
    const sql = 'SELECT * FROM guests WHERE event_id = ? ORDER BY name';
    db.query(sql, [req.params.eventId], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(results);
        }
    });
});

// Get single guest
app.get('/api/guests/:id', (req, res) => {
    db.query('SELECT * FROM guests WHERE id = ?', [req.params.id], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (results.length === 0) {
            res.status(404).json({ error: 'Guest not found' });
        } else {
            res.json(results[0]);
        }
    });
});

// ==================== TABLE MANAGEMENT ROUTES ====================

// Assign table to guest
app.post('/api/guests/:id/table', (req, res) => {
    const { table_number } = req.body;
    
    db.query('UPDATE guests SET table_number = ? WHERE id = ?', [table_number || null, req.params.id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'Table assigned successfully' });
        }
    });
});

// Get table layout for event
app.get('/api/tables/event/:eventId', (req, res) => {
    const sql = `
        SELECT table_number, 
               COUNT(*) as guest_count,
               GROUP_CONCAT(name SEPARATOR ', ') as guests
        FROM guests 
        WHERE event_id = ? AND table_number IS NOT NULL AND table_number != ''
        GROUP BY table_number
        ORDER BY table_number
    `;
    
    db.query(sql, [req.params.eventId], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(results);
        }
    });
});

// ==================== EXPORT ROUTES ====================

// Export guests to CSV
app.get('/api/export/guests/:eventId', (req, res) => {
    const sql = `
        SELECT guests.name, guests.email, guests.phone, guests.table_number,
               guests.checked_in, guests.check_in_time, guests.unique_code
        FROM guests 
        WHERE guests.event_id = ?
        ORDER BY guests.name
    `;
    
    db.query(sql, [req.params.eventId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ error: 'No guests found for this event' });
        }
        
        // Create CSV content
        let csv = 'Name,Email,Phone,Table,Checked In,Check-in Time,QR Code\n';
        
        results.forEach(guest => {
            csv += `"${guest.name || ''}",`;
            csv += `"${guest.email || ''}",`;
            csv += `"${guest.phone || ''}",`;
            csv += `"${guest.table_number || ''}",`;
            csv += `${guest.checked_in ? 'Yes' : 'No'},`;
            csv += `"${guest.check_in_time ? new Date(guest.check_in_time).toLocaleString() : ''}",`;
            csv += `"${guest.unique_code || ''}"\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=guests_event_${req.params.eventId}.csv`);
        res.send(csv);
    });
});

// ==================== INVITATION PAGE WITH ALL CARD DESIGNS ====================
app.get('/invite/:code', (req, res) => {
    const sql = `
        SELECT guests.*, events.event_name, events.event_date, events.event_time, events.venue, events.card_design
        FROM guests 
        JOIN events ON guests.event_id = events.id 
        WHERE guests.unique_code = ?
    `;
    
    db.query(sql, [req.params.code], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Invalid Invitation</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                            margin: 0;
                        }
                        .card {
                            background: white;
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 500px;
                            width: 100%;
                            text-align: center;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        }
                        h1 { color: #dc3545; margin-bottom: 20px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>❌ Invalid Invitation</h1>
                        <p>This invitation does not exist or has been removed.</p>
                    </div>
                </body>
                </html>
            `);
        }
        
        const guest = results[0];
        const scanUrl = `https://event-qr-system-7vgo.onrender.com/scan/${guest.unique_code}`;
        
        QRCode.toDataURL(scanUrl, (err, qrCodeUrl) => {
            const formattedDate = new Date(guest.event_date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            // Format time
            const formattedTime = guest.event_time ? guest.event_time.substring(0, 5) : 'TBA';
            
            // Choose design based on card_design
            let cardHTML = '';
            
            if (guest.card_design === 'wedding') {
                // WEDDING CARD - Islamic style with welcome message
                cardHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Wedding Invitation</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            * { margin: 0; padding: 0; box-sizing: border-box; }
                            body {
                                min-height: 100vh;
                                background: linear-gradient(135deg, #f5e6d3 0%, #e8d5b5 100%);
                                font-family: 'Georgia', 'Times New Roman', serif;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 20px;
                                position: relative;
                            }
                            body::before {
                                content: '';
                                position: fixed;
                                top: 10px;
                                left: 10px;
                                right: 10px;
                                bottom: 10px;
                                border: 2px solid #b8860b;
                                border-radius: 30px;
                                pointer-events: none;
                                opacity: 0.5;
                            }
                            .card {
                                max-width: 600px;
                                width: 100%;
                                background: rgba(255, 255, 255, 0.98);
                                border-radius: 30px;
                                padding: 50px 40px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                text-align: center;
                                position: relative;
                                border: 5px solid #b8860b;
                            }
                            .corner {
                                position: absolute;
                                width: 60px;
                                height: 60px;
                                border: 3px solid #b8860b;
                            }
                            .corner-tl { top: 15px; left: 15px; border-right: none; border-bottom: none; }
                            .corner-tr { top: 15px; right: 15px; border-left: none; border-bottom: none; }
                            .corner-bl { bottom: 15px; left: 15px; border-right: none; border-top: none; }
                            .corner-br { bottom: 15px; right: 15px; border-left: none; border-top: none; }
                            
                            .arabic-top {
                                font-size: 2.2em;
                                color: #8b5a2b;
                                margin-bottom: 20px;
                                font-family: 'Traditional Arabic', serif;
                            }
                            
                            .welcome-message {
                                font-size: 1.3em;
                                color: #8b4513;
                                margin: 20px 0;
                                font-style: italic;
                                line-height: 1.6;
                            }
                            
                            .inviter-section {
                                margin: 30px 0;
                                padding: 20px;
                                border-top: 2px solid #b8860b;
                                border-bottom: 2px solid #b8860b;
                            }
                            
                            .inviter-name {
                                font-size: 1.6em;
                                color: #8b4513;
                                font-weight: bold;
                                margin: 10px 0;
                                text-transform: uppercase;
                                letter-spacing: 2px;
                            }
                            
                            .inviter-message {
                                font-size: 1.2em;
                                color: #8b5a2b;
                                margin: 15px 0;
                                line-height: 1.6;
                            }
                            
                            .guest-name {
                                font-size: 2.5em;
                                color: #b8860b;
                                margin: 25px 0;
                                font-weight: bold;
                                border-bottom: 2px solid #b8860b;
                                display: inline-block;
                                padding-bottom: 10px;
                            }
                            
                            .event-name {
                                font-size: 1.8em;
                                color: #8b4513;
                                margin: 15px 0;
                                font-weight: bold;
                            }
                            
                            .details {
                                background: rgba(184, 134, 11, 0.1);
                                padding: 25px;
                                border-radius: 15px;
                                margin: 25px 0;
                            }
                            
                            .details p {
                                margin: 12px 0;
                                font-size: 1.1em;
                                color: #5a3e1b;
                            }
                            
                            .qr-section {
                                margin: 30px 0 20px;
                                padding: 20px;
                                background: #fff9f0;
                                border-radius: 15px;
                                border: 2px dashed #b8860b;
                            }
                            
                            .qr-section img {
                                max-width: 220px;
                                border: 3px solid #b8860b;
                                padding: 10px;
                                background: white;
                                border-radius: 15px;
                                margin: 15px 0;
                            }
                            
                            .footer {
                                margin-top: 20px;
                                font-size: 1em;
                                color: #8b5a2b;
                            }
                            
                            .status {
                                display: inline-block;
                                padding: 8px 25px;
                                background: ${guest.checked_in ? '#d4edda' : '#fff3cd'};
                                color: ${guest.checked_in ? '#155724' : '#856404'};
                                border-radius: 50px;
                                font-weight: bold;
                                margin-bottom: 20px;
                            }
                            
                            .note {
                                font-size: 0.9em;
                                color: #b8860b;
                                margin-top: 10px;
                                font-style: italic;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="corner corner-tl"></div>
                            <div class="corner corner-tr"></div>
                            <div class="corner corner-bl"></div>
                            <div class="corner corner-br"></div>
                            
                            <div class="status">
                                ${guest.checked_in ? '✓ Already Checked In' : '✨ Wedding Guest'}
                            </div>
                            
                            <!-- Single Arabic line -->
                            <div class="arabic-top">
                                ﷽
                            </div>
                            
                            <div style="color: #8b5a2b; margin-bottom: 20px; font-size: 1.1em;">
                                IN THE NAME OF ALLAH, THE MOST BENEFICENT, THE MOST MERCIFUL
                            </div>
                            
                            <div class="welcome-message">
                                You are cordially invited to celebrate<br>
                                the wedding ceremony of
                            </div>
                            
                            <div class="inviter-section">
                                <div class="inviter-name">SHIFAA ABDALLAH ALBEITY ANAFURAHA</div>
                                <div class="inviter-message">
                                    KUKUALIKA KATIKA SHEREHE YA SUBHA<br>
                                    YA KUWAONGOA WATOTO WAKE<br>
                                    WAPENDWA
                                </div>
                            </div>
                            
                            <div style="font-size: 1.4em; color: #8b4513; margin: 15px 0;">
                                <strong>Mohammad Fauz Rudainy</strong> 
                                <span style="color: #b8860b; font-size: 1.2em;">&</span> 
                                <strong>Imtithal Rashid Suleiman</strong>
                            </div>
                            
                            <div class="guest-name">${guest.name}</div>
                            
                            <div class="details">
                                <p><strong>SUNDAY</strong></p>
                                <p>19TH APRIL, 2026</p>
                                <p>⏰ ${formattedTime}</p>
                                <p><strong>Location:</strong> BADALA HALL</p>
                            </div>
                            
                            <div class="qr-section">
                                <p><strong>Entry Pass</strong></p>
                                <img src="${qrCodeUrl}" alt="QR Code">
                                <p class="note">This QR code can only be used once</p>
                                <p style="margin-top: 10px;">Please present this QR code at the entrance</p>
                            </div>
                            
                            <div class="footer">
                                وَبِاللَّهِ التَّوْفِيق<br>
                                WABILLAHY TAUFIQ
                            </div>
                            
                            <div class="note">
                                TAFADHALI NJOO NA KADI HII<br>
                                WATOTO HAWARUHUSWI
                            </div>
                        </div>
                    </body>
                    </html>
                `;
            } else if (guest.card_design === 'birthday') {
                // BIRTHDAY CARD with welcome message
                cardHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Birthday Invitation</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body {
                                margin: 0;
                                min-height: 100vh;
                                background: linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%);
                                font-family: 'Comic Sans MS', cursive, sans-serif;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 20px;
                            }
                            .card {
                                max-width: 550px;
                                width: 100%;
                                background: white;
                                border-radius: 40px;
                                padding: 50px 40px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.2);
                                text-align: center;
                                border: 5px solid #ff6b6b;
                                position: relative;
                                animation: float 3s ease-in-out infinite;
                            }
                            @keyframes float {
                                0% { transform: translateY(0px); }
                                50% { transform: translateY(-10px); }
                                100% { transform: translateY(0px); }
                            }
                            h1 {
                                color: #ff6b6b;
                                font-size: 2.8em;
                                margin-bottom: 20px;
                                text-shadow: 2px 2px 4px rgba(255,107,107,0.2);
                            }
                            .welcome-message {
                                font-size: 1.4em;
                                color: #b13e3e;
                                margin: 20px 0;
                                line-height: 1.6;
                                font-style: italic;
                            }
                            .guest-name {
                                font-size: 2.8em;
                                color: #ff6b6b;
                                margin: 25px 0;
                                font-weight: bold;
                                background: #fff3cd;
                                padding: 15px 30px;
                                border-radius: 60px;
                                display: inline-block;
                                box-shadow: 0 5px 15px rgba(255,107,107,0.2);
                            }
                            .event-name {
                                font-size: 1.8em;
                                color: #b13e3e;
                                margin: 15px 0;
                                font-weight: bold;
                            }
                            .details {
                                background: #fff3cd;
                                padding: 25px;
                                border-radius: 20px;
                                margin: 25px 0;
                                border: 2px dashed #ff6b6b;
                            }
                            .details p {
                                margin: 10px 0;
                                font-size: 1.2em;
                                color: #b13e3e;
                            }
                            .qr-section {
                                margin: 30px 0 20px;
                                padding: 20px;
                                background: #fff9f0;
                                border-radius: 20px;
                            }
                            .qr-section img {
                                max-width: 220px;
                                border: 5px solid #ff6b6b;
                                padding: 10px;
                                background: white;
                                border-radius: 25px;
                                margin: 15px 0;
                            }
                            .note {
                                font-size: 0.95em;
                                color: #ff6b6b;
                                margin-top: 10px;
                                font-style: italic;
                            }
                            .status {
                                display: inline-block;
                                padding: 8px 25px;
                                background: ${guest.checked_in ? '#d4edda' : '#fff3cd'};
                                color: ${guest.checked_in ? '#155724' : '#856404'};
                                border-radius: 50px;
                                font-weight: bold;
                                margin-bottom: 20px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="status">
                                ${guest.checked_in ? '✓ Already Checked In' : '🎂 Birthday Guest'}
                            </div>
                            
                            <h1>🎉 Happy Birthday! 🎉</h1>
                            
                            <div class="welcome-message">
                                You are cordially invited to celebrate<br>
                                the birthday of
                            </div>
                            
                            <div class="guest-name">${guest.name}</div>
                            
                            <div class="welcome-message" style="font-size: 1.2em;">
                                Your presence will make<br>
                                this day truly special!
                            </div>
                            
                            <div class="event-name">${guest.event_name}</div>
                            
                            <div class="details">
                                <p><strong>📅 ${formattedDate}</strong></p>
                                <p><strong>⏰ ${formattedTime}</strong></p>
                                <p><strong>📍 ${guest.venue}</strong></p>
                            </div>
                            
                            <div class="qr-section">
                                <img src="${qrCodeUrl}" alt="QR Code">
                                <p class="note">This QR code can only be used once</p>
                                <p style="margin-top: 10px;">Please present this QR code at the entrance</p>
                            </div>
                            
                            <div class="note">
                                Come ready to party! 🎈🎂🎁
                            </div>
                        </div>
                    </body>
                    </html>
                `;
            } else if (guest.card_design === 'graduation') {
                // GRADUATION CARD with welcome message
                cardHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Graduation Invitation</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body {
                                margin: 0;
                                min-height: 100vh;
                                background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                                font-family: 'Times New Roman', serif;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 20px;
                            }
                            .card {
                                max-width: 550px;
                                width: 100%;
                                background: white;
                                border-radius: 30px;
                                padding: 50px 40px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                text-align: center;
                                border: 3px solid #d4af37;
                                position: relative;
                            }
                            .cap-icon {
                                font-size: 4em;
                                margin-bottom: 10px;
                            }
                            h1 {
                                color: #1e3c72;
                                font-size: 2.5em;
                                margin-bottom: 20px;
                            }
                            .welcome-message {
                                font-size: 1.3em;
                                color: #2a5298;
                                margin: 20px 0;
                                line-height: 1.6;
                                font-style: italic;
                            }
                            .guest-name {
                                font-size: 2.5em;
                                color: #2a5298;
                                margin: 25px 0;
                                font-weight: bold;
                                border-bottom: 2px solid #d4af37;
                                display: inline-block;
                                padding-bottom: 10px;
                            }
                            .event-name {
                                font-size: 1.8em;
                                color: #1e3c72;
                                margin: 15px 0;
                                font-weight: bold;
                            }
                            .details {
                                background: #f0f2f5;
                                padding: 25px;
                                border-radius: 15px;
                                margin: 25px 0;
                                border: 1px solid #d4af37;
                            }
                            .qr-section {
                                margin: 30px 0 20px;
                            }
                            .qr-section img {
                                max-width: 220px;
                                border: 3px solid #2a5298;
                                padding: 10px;
                                background: white;
                                border-radius: 15px;
                                margin: 15px 0;
                            }
                            .status {
                                display: inline-block;
                                padding: 8px 25px;
                                background: ${guest.checked_in ? '#d4edda' : '#fff3cd'};
                                color: ${guest.checked_in ? '#155724' : '#856404'};
                                border-radius: 50px;
                                font-weight: bold;
                                margin-bottom: 20px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="cap-icon">🎓</div>
                            <div class="status">
                                ${guest.checked_in ? '✓ Already Checked In' : '🎓 Graduation Guest'}
                            </div>
                            
                            <h1>Graduation Celebration</h1>
                            
                            <div class="welcome-message">
                                You are cordially invited to celebrate<br>
                                the graduation of
                            </div>
                            
                            <div class="guest-name">${guest.name}</div>
                            
                            <div class="welcome-message" style="font-size: 1.1em;">
                                Join us in honoring this<br>
                                incredible achievement!
                            </div>
                            
                            <div class="event-name">${guest.event_name}</div>
                            
                            <div class="details">
                                <p><strong>📅 ${formattedDate}</strong></p>
                                <p><strong>⏰ ${formattedTime}</strong></p>
                                <p><strong>📍 ${guest.venue}</strong></p>
                            </div>
                            
                            <div class="qr-section">
                                <img src="${qrCodeUrl}" alt="QR Code">
                                <p class="note">This QR code can only be used once</p>
                                <p style="margin-top: 10px;">Please present this QR code at the entrance</p>
                            </div>
                            
                            <div class="note">
                                Congratulations Graduate! 🎉
                            </div>
                        </div>
                    </body>
                    </html>
                `;
            } else {
                // DEFAULT PARTY CARD with welcome message
                cardHTML = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Party Invitation</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body {
                                margin: 0;
                                min-height: 100vh;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                font-family: 'Arial', sans-serif;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 20px;
                            }
                            .card {
                                max-width: 550px;
                                width: 100%;
                                background: white;
                                border-radius: 30px;
                                padding: 50px 40px;
                                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                                text-align: center;
                                border: 3px solid #764ba2;
                                position: relative;
                            }
                            h1 {
                                background: linear-gradient(135deg, #667eea, #764ba2);
                                -webkit-background-clip: text;
                                -webkit-text-fill-color: transparent;
                                font-size: 2.8em;
                                margin-bottom: 20px;
                            }
                            .welcome-message {
                                font-size: 1.3em;
                                color: #667eea;
                                margin: 20px 0;
                                line-height: 1.6;
                            }
                            .guest-name {
                                font-size: 2.8em;
                                color: #764ba2;
                                margin: 25px 0;
                                font-weight: bold;
                                border-bottom: 2px solid #667eea;
                                display: inline-block;
                                padding-bottom: 10px;
                            }
                            .event-name {
                                font-size: 1.8em;
                                color: #667eea;
                                margin: 15px 0;
                                font-weight: bold;
                            }
                            .details {
                                background: #f0f2f5;
                                padding: 25px;
                                border-radius: 15px;
                                margin: 25px 0;
                            }
                            .qr-section {
                                margin: 30px 0 20px;
                            }
                            .qr-section img {
                                max-width: 220px;
                                border: 3px solid #764ba2;
                                padding: 10px;
                                background: white;
                                border-radius: 15px;
                                margin: 15px 0;
                            }
                            .status {
                                display: inline-block;
                                padding: 8px 25px;
                                background: ${guest.checked_in ? '#d4edda' : '#fff3cd'};
                                color: ${guest.checked_in ? '#155724' : '#856404'};
                                border-radius: 50px;
                                font-weight: bold;
                                margin-bottom: 20px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="status">
                                ${guest.checked_in ? '✓ Already Checked In' : '🎊 Party Guest'}
                            </div>
                            
                            <h1>🎊 You're Invited! 🎊</h1>
                            
                            <div class="welcome-message">
                                You are cordially invited to<br>
                                join us for
                            </div>
                            
                            <div class="guest-name">${guest.name}</div>
                            
                            <div class="event-name">${guest.event_name}</div>
                            
                            <div class="details">
                                <p><strong>📅 ${formattedDate}</strong></p>
                                <p><strong>⏰ ${formattedTime}</strong></p>
                                <p><strong>📍 ${guest.venue}</strong></p>
                                ${guest.table_number ? `<p>🪑 Table: ${guest.table_number}</p>` : ''}
                            </div>
                            
                            <div class="qr-section">
                                <img src="${qrCodeUrl}" alt="QR Code">
                                <p class="note">This QR code can only be used once</p>
                                <p style="margin-top: 10px;">Please present this QR code at the entrance</p>
                            </div>
                            
                            <div class="note">
                                Come celebrate with us! 🎉
                            </div>
                        </div>
                    </body>
                    </html>
                `;
            }
            
            res.send(cardHTML);
        });
    });
});

// ==================== SCAN PAGE ====================
app.get('/scan/:code', (req, res) => {
    const sql = `
        SELECT guests.*, events.event_name, events.event_date, events.venue 
        FROM guests 
        JOIN events ON guests.event_id = events.id 
        WHERE guests.unique_code = ?
    `;
    
    db.query(sql, [req.params.code], (err, results) => {
        if (err || results.length === 0) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Invalid QR Code</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: #f8f9fa;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            min-height: 100vh;
                            margin: 0;
                            padding: 20px;
                        }
                        .card {
                            background: white;
                            padding: 40px;
                            border-radius: 15px;
                            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                            text-align: center;
                            max-width: 400px;
                            width: 100%;
                        }
                        h1 { color: #dc3545; margin-bottom: 20px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>❌ Invalid QR Code</h1>
                        <p>This QR code is not recognized in our system.</p>
                    </div>
                </body>
                </html>
            `);
        }
        
        const guest = results[0];
        
        if (guest.checked_in) {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Already Checked In</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: #fff3cd;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            min-height: 100vh;
                            margin: 0;
                            padding: 20px;
                        }
                        .card {
                            background: white;
                            padding: 40px;
                            border-radius: 15px;
                            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                            text-align: center;
                            max-width: 400px;
                            width: 100%;
                            border-left: 4px solid #ffc107;
                        }
                        h1 { color: #856404; margin-bottom: 20px; }
                        .name { font-size: 2.2em; color: #333; margin: 20px 0; }
                        .time { 
                            color: #666; 
                            margin: 15px 0;
                            padding: 10px;
                            background: #f8f9fa;
                            border-radius: 5px;
                        }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>⛔ Already Checked In</h1>
                        <div class="name">${guest.name}</div>
                        <p><strong>Event:</strong> ${guest.event_name}</p>
                        <p><strong>Location:</strong> ${guest.venue}</p>
                        <p><strong>Date:</strong> ${new Date(guest.event_date).toLocaleDateString()}</p>
                        <div class="time">
                            Checked in at:<br>
                            ${new Date(guest.check_in_time).toLocaleString()}
                        </div>
                    </div>
                </body>
                </html>
            `);
        } else {
            db.query('UPDATE guests SET checked_in = TRUE, check_in_time = NOW() WHERE id = ?', [guest.id], (err) => {
                if (err) {
                    res.send('<h1>Error during check-in</h1>');
                } else {
                    res.send(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Check-in Successful</title>
                            <meta name="viewport" content="width=device-width, initial-scale=1">
                            <style>
                                body {
                                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                                    background: linear-gradient(135deg, #4CAF50, #45a049);
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    min-height: 100vh;
                                    margin: 0;
                                    padding: 20px;
                                }
                                .card {
                                    background: white;
                                    padding: 50px;
                                    border-radius: 25px;
                                    box-shadow: 0 20px 40px rgba(0,0,0,0.2);
                                    text-align: center;
                                    max-width: 450px;
                                    width: 100%;
                                }
                                h1 { color: #28a745; margin-bottom: 20px; font-size: 2.2em; }
                                .name { font-size: 2.5em; color: #333; margin: 20px 0; font-weight: bold; }
                                .details { 
                                    color: #666; 
                                    margin: 20px 0;
                                    padding: 15px;
                                    background: #f8f9fa;
                                    border-radius: 10px;
                                }
                                .time { 
                                    background: #e9ecef;
                                    padding: 15px;
                                    border-radius: 10px;
                                    margin: 20px 0;
                                    font-size: 1.1em;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="card">
                                <h1>✅ Welcome!</h1>
                                <div class="name">${guest.name}</div>
                                <div class="details">
                                    <p><strong>Event:</strong> ${guest.event_name}</p>
                                    <p><strong>Location:</strong> ${guest.venue}</p>
                                    <p><strong>Date:</strong> ${new Date(guest.event_date).toLocaleDateString()}</p>
                                    ${guest.table_number ? `<p><strong>Table:</strong> ${guest.table_number}</p>` : ''}
                                </div>
                                <div class="time">
                                    Check-in successful at:<br>
                                    <strong>${new Date().toLocaleTimeString()}</strong>
                                </div>
                                <p style="margin-top: 20px; font-size: 1.2em;">Enjoy the event! 🎉</p>
                            </div>
                        </body>
                        </html>
                    `);
                }
            });
        }
    });
});

// ==================== START SERVER ====================
app.listen(port, () => {
    console.log(`\n🚀 Server running at http://localhost:${port}`);
    console.log(`📊 Dashboard: http://localhost:${port}/api/stats`);
    console.log(`💍 Wedding: http://localhost:${port}/invite/[code]`);
    console.log(`🎂 Birthday: http://localhost:${port}/invite/[code]`);
    console.log(`🎓 Graduation: http://localhost:${port}/invite/[code]`);
    console.log(`💕 Anniversary: http://localhost:${port}/invite/[code]`);
    console.log(`💼 Corporate: http://localhost:${port}/invite/[code]`);
    console.log(`🎊 Party: http://localhost:${port}/invite/[code]`);
    console.log(`📱 Scanner: http://localhost:${port}/scan/[code]`);
    console.log(`📥 Export: http://localhost:${port}/api/export/guests/[eventId]\n`);
});