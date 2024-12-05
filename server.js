// server.js

const express = require('express');
const multer = require('multer');
const ejs = require('ejs');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');

const app = express();

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads'); // Save files in the 'uploads' directory
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Limit file size to 5 MB
});

// Configure EJS as the view engine
app.set('view engine', 'ejs');

// Serve static files from the 'uploads' and 'public' directories
app.use('/uploads', express.static('uploads'));
app.use('/css', express.static('public/css'));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('fridge.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      date_added TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      fridge TEXT NOT NULL,
      image_path TEXT NOT NULL
    )`);
  }
});

// Helper function to format dates as 'YYYY-MM-DD'
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Render index page
app.get('/', (req, res) => {
  const today = new Date();
  const todayDate = today.toISOString().split('T')[0]; // Format: 'YYYY-MM-DD'
  res.render('index', { 
    error: req.query.error, 
    added: req.query.added, 
    todayDate 
  });
});

// Adding Item
app.post('/add-item', upload.single('photo'), async (req, res) => {
  const { username, days_to_store, expiry_date, fridge } = req.body;
  
  if (!username || !fridge || !req.file) {
    return res.status(400).redirect('/?error=Username,+Fridge+selection,+and+a+valid+image+are+required.');
  }

  let expiryDate;

  if (expiry_date) {
    // If expiry_date is provided, use it directly
    expiryDate = new Date(expiry_date);
  } else if (days_to_store) {
    // Calculate expiry date based on days_to_store
    const days = parseInt(days_to_store, 10);
    if (isNaN(days) || days < 1) {
      return res.status(400).redirect('/?error=Please+enter+a+valid+number+of+days+to+store.');
    }
    expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
  } else {
    return res.status(400).redirect('/?error=Please+provide+either+Days+to+Store+or+Expiry+Date.');
  }

  const dateAdded = new Date();
  const dateAddedStr = formatDate(dateAdded);
  const expiryDateStr = formatDate(expiryDate);

  const imagePath = req.file.path;

  try {
    // Resize the image to a maximum width of 800px while maintaining aspect ratio
    await sharp(imagePath)
      .resize({ width: 800 })
      .toFile(`${imagePath}-resized`);
    
    // Replace the original image with the resized one
    fs.unlinkSync(imagePath); // Remove original
    fs.renameSync(`${imagePath}-resized`, imagePath); // Rename resized
  } catch (error) {
    console.error('Error processing image:', error.message);
    return res.status(500).redirect('/?error=Image+processing+failed.');
  }

  db.run(`INSERT INTO items (username, date_added, expiry_date, fridge, image_path)
          VALUES (?, ?, ?, ?, ?)`,
    [username, dateAddedStr, expiryDateStr, fridge, imagePath],
    function(err) {
      if (err) {
        console.error('Error inserting item:', err.message);
        return res.status(500).redirect('/?error=Failed+to+add+item+to+database.');
      }
      res.redirect('/?added=true');
    });
});

// Monitor Page
app.get('/monitor', (req, res) => {
  const today = formatDate(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(new Date().getDate() + 1);
  const tomorrow = formatDate(tomorrowDate);

  db.all(`SELECT * FROM items`, [], (err, items) => {
    if (err) {
      console.error('Error fetching items:', err.message);
      return res.status(500).send('Database error occurred.');
    }

    const expired = items.filter(item => item.expiry_date < today);
    const expiringToday = items.filter(item => item.expiry_date === today);
    const expiringSoon = items.filter(item => item.expiry_date === tomorrow);

    const fridgeCounts = {};
    items.forEach(item => {
      if (fridgeCounts[item.fridge]) {
        fridgeCounts[item.fridge]++;
      } else {
        fridgeCounts[item.fridge] = 1;
      }
    });

    res.render('monitor', { expired, expiringToday, expiringSoon, fridgeCounts, deleted: req.query.deleted });
  });
});

// Delete Item
app.post('/delete-item/:id', (req, res) => {
  const id = req.params.id;

  db.get(`SELECT image_path FROM items WHERE id = ?`, [id], (err, row) => {
    if (err) {
      console.error('Error fetching item:', err.message);
      return res.status(500).send('Database error occurred.');
    }

    if (row) {
      // Delete the image file
      fs.unlink(row.image_path, (err) => {
        if (err) {
          console.error('Error deleting image file:', err.message);
        }
        // Delete the item from the database
        db.run(`DELETE FROM items WHERE id = ?`, [id], function(err) {
          if (err) {
            console.error('Error deleting item:', err.message);
            return res.status(500).send('Database error occurred.');
          }
          res.redirect('/monitor?deleted=true');
        });
      });
    } else {
      res.status(404).send('Item not found.');
    }
  });
});

// Handle GET request for /my-items
app.get('/my-items', (req, res) => {
  res.render('my-items', { error: undefined, items: undefined, usernames: undefined, selectedUsername: undefined });
});

// Handle POST request for /my-items
app.post('/my-items', (req, res) => {
  const inputUsername = req.body.username.trim();

  if (inputUsername.length < 3) {
    return res.render('my-items', { error: 'Please enter at least 3 characters.', items: undefined, usernames: undefined, selectedUsername: undefined });
  }

  // Search for usernames that match the input
  db.all(`SELECT DISTINCT username FROM items WHERE username LIKE ?`, [`%${inputUsername}%`], (err, rows) => {
    if (err) {
      console.error('Error fetching usernames:', err.message);
      return res.status(500).render('my-items', { error: 'Database error occurred.', items: undefined, usernames: undefined, selectedUsername: undefined });
    }

    if (rows.length === 0) {
      // No matching usernames
      return res.render('my-items', { error: 'No users found matching that username.', items: undefined, usernames: undefined, selectedUsername: undefined });
    } else if (rows.length === 1) {
      // Only one matching username, fetch items for that user
      const username = rows[0].username;
      db.all(`SELECT * FROM items WHERE username = ?`, [username], (err, items) => {
        if (err) {
          console.error('Error fetching items:', err.message);
          return res.status(500).render('my-items', { error: 'Database error occurred.', items: undefined, usernames: undefined, selectedUsername: undefined });
        }
        res.render('my-items', { error: undefined, items, usernames: undefined, selectedUsername: username });
      });
    } else {
      // Multiple matching usernames, display list for user to select
      const usernames = rows.map(row => row.username);
      res.render('my-items', { error: undefined, items: undefined, usernames, selectedUsername: undefined });
    }
  });
});

// Handle POST request for username selection
app.post('/my-items/select-username', (req, res) => {
  const username = req.body.selectedUsername;

  db.all(`SELECT * FROM items WHERE username = ?`, [username], (err, items) => {
    if (err) {
      console.error('Error fetching items:', err.message);
      return res.status(500).render('my-items', { error: 'Database error occurred.', items: undefined, usernames: undefined, selectedUsername: undefined });
    }
    res.render('my-items', { error: undefined, items, usernames: undefined, selectedUsername: username });
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
