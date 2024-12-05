const express = require('express');
const path = require('path'); // For handling file paths
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs'); // For file system operations
const app = express();
const PORT = 3000;

// Initialize Database
const db = new sqlite3.Database('./fridge.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    date_added TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    fridge TEXT NOT NULL,
    image_path TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Error initializing database:', err.message);
    } else {
      console.log('Database initialized successfully.');
    }
  });
});

// Ensure 'uploads' directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Use Date.now() for unique filenames
    cb(null, Date.now() + '-' + file.originalname);
  }
});

// Define Accepted MIME Types
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp'
];

// Multer File Filter
const fileFilter = (req, file, cb) => {
  if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Only JPEG, PNG, GIF, BMP, and WEBP are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB limit
});

// Serve Static Files
app.use('/uploads', express.static('uploads')); // Serve uploaded images
app.use(express.static('public')); // Serve general static files like CSS, JS, images

// Set View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // Specify the views directory

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper Function to Format Dates as 'YYYY-MM-DD'
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = (`0${(date.getMonth() + 1)}`).slice(-2); // Months are zero-based
  const day = (`0${date.getDate()}`).slice(-2);
  return `${year}-${month}-${day}`;
};

// Routes

// Serve index.ejs at '/'
app.get('/', (req, res) => {
  res.render('index');
});

// Adding Item
const sharp = require('sharp');

app.post('/add-item', upload.single('photo'), async (req, res) => {
  const { username, days_to_store, expiry_date, fridge } = req.body;
  
  if (!username || !fridge || !req.file) {
    return res.status(400).render('index', { error: 'Username, Fridge selection, and a valid image are required.' });
  }

  let expiryDate;

  if (expiry_date) {
    // If expiry_date is provided, use it directly
    expiryDate = new Date(expiry_date);
  } else if (days_to_store) {
    // Calculate expiry date based on days_to_store
    const days = parseInt(days_to_store, 10);
    if (isNaN(days) || days < 1) {
      return res.status(400).render('index', { error: 'Please enter a valid number of days to store.' });
    }
    expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
  } else {
    return res.status(400).render('index', { error: 'Please provide either Days to Store or Expiry Date.' });
  }

  const dateAdded = new Date();
  const dateAddedStr = formatDate(dateAdded);
  const expiryDateStr = formatDate(expiryDate);

  const imagePath = req.file.path;

  try {
    // Optional: Resize the image using Sharp
    await sharp(imagePath)
      .resize({ width: 800 })
      .toFile(`${imagePath}-resized`);
    
    // Replace the original image with the resized one
    fs.unlinkSync(imagePath); // Remove original
    fs.renameSync(`${imagePath}-resized`, imagePath); // Rename resized
  } catch (error) {
    console.error('Error processing image:', error.message);
    return res.status(500).render('index', { error: 'Image processing failed.' });
  }

  db.run(`INSERT INTO items (username, date_added, expiry_date, fridge, image_path)
          VALUES (?, ?, ?, ?, ?)`,
    [username, dateAddedStr, expiryDateStr, fridge, imagePath],
    function(err) {
      if (err) {
        console.error('Error inserting item:', err.message);
        return res.status(500).render('index', { error: 'Failed to add item to database.' });
      }
      res.redirect('/');
    });
});


//deleting item
app.post('/delete-item/:id', (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM items WHERE id = ?`, [id], function(err) {
    if (err) {
      console.error('Error deleting item:', err.message);
      return res.status(500).send('Error deleting item.');
    }
    // Optionally, add a query parameter to indicate success
    res.redirect('/monitor?deleted=true');
  });
});


// Monitor
app.get('/monitor', (req, res) => {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const todayStr = formatDate(today);
  const tomorrowStr = formatDate(tomorrow);

  db.all(`SELECT * FROM items`, [], (err, rows) => {
    if (err) {
      console.error('Error retrieving items:', err.message);
      return res.status(500).send('Error retrieving items.');
    }

    const expired = [];
    const expiringToday = [];
    const expiringSoon = [];

    rows.forEach(item => {
      if (item.expiry_date < todayStr) {
        expired.push(item);
      } else if (item.expiry_date === todayStr) {
        expiringToday.push(item);
      } else if (item.expiry_date === tomorrowStr) {
        expiringSoon.push(item);
      }
    });

    // Count items in each fridge
    const fridgeCounts = rows.reduce((counts, item) => {
      if (counts[item.fridge]) {
        counts[item.fridge] += 1;
      } else {
        counts[item.fridge] = 1;
      }
      return counts;
    }, {});

    // Check if an item was deleted
    const deleted = req.query.deleted;

    res.render('monitor', { expired, expiringToday, expiringSoon, fridgeCounts, deleted });
  });
});

// Delete Item
app.post('/delete-item/:id', (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM items WHERE id = ?`, [id], function(err) {
    if (err) {
      console.error('Error deleting item:', err.message);
      return res.status(500).send('Error deleting item.');
    }
    res.redirect('/monitor');
  });
});

// New Route: View and Remove User's Items
app.get('/my-items', (req, res) => {
  res.render('my-items'); // Render the form to enter username
});

app.post('/my-items', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).render('my-items', { error: 'Username is required.' });
  }

  db.all(`SELECT * FROM items WHERE username = ?`, [username], (err, rows) => {
    if (err) {
      console.error('Error retrieving user items:', err.message);
      return res.status(500).render('my-items', { error: 'Error retrieving your items.' });
    }

    res.render('my-items', { items: rows, username: username });
  });
});

// Global Error Handler for Multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Handle Multer-specific errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).render('index', { error: 'File size is too large. Maximum limit is 5MB.' });
    }
    return res.status(400).render('index', { error: err.message });
  } else if (err) {
    // Handle other errors
    return res.status(400).render('index', { error: err.message });
  }
  next();
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});