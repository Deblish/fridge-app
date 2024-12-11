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

  // Validate username length (at least 3 chars)
  if (!username || username.trim().length < 3) {
    // Delete the uploaded file if any (in case user tried to upload but validation fails)
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err.message);
      });
    }
    return res.status(400).redirect('/?error=Username must be at least 3 characters long.');
  }

  // Validate picture presence
  if (!req.file) {
    // No picture uploaded
    return res.status(400).redirect('/?error=Picture is missing.');
  }

  // Validate fridge selection
  if (!fridge) {
    // Delete the uploaded file if fridge is missing
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err.message);
      });
    }
    return res.status(400).redirect('/?error=Fridge selection is required.');
  }

  let expiryDate;

  if (expiry_date) {
    // If expiry_date is provided, use it directly
    expiryDate = new Date(expiry_date);
  } else if (days_to_store) {
    // Calculate expiry date based on days_to_store
    const days = parseInt(days_to_store, 10);
    if (isNaN(days) || days < 1) {
      // Delete the uploaded file if days_to_store is invalid
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('Error deleting file:', err.message);
        });
      }
      return res.status(400).redirect('/?error=Please enter a valid number of days to store.');
    }
    expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
  } else {
    // Delete the uploaded file if neither expiry_date nor days_to_store is provided
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err.message);
      });
    }
    return res.status(400).redirect('/?error=Please provide either Days to Store or Expiry Date.');
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
    // Delete the uploaded file if image processing fails
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err.message);
      });
    }
    return res.status(500).redirect('/?error=Image processing failed.');
  }

  db.run(`INSERT INTO items (username, date_added, expiry_date, fridge, image_path)
          VALUES (?, ?, ?, ?, ?)`,
    [username.trim(), dateAddedStr, expiryDateStr, fridge, imagePath],
    function(err) {
      if (err) {
        console.error('Error inserting item:', err.message);
        // Delete the uploaded file if database insertion fails
        if (req.file && req.file.path) {
          fs.unlink(req.file.path, (err) => {
            if (err) console.error('Error deleting file:', err.message);
          });
        }
        return res.status(500).redirect('/?error=Failed to add item to database.');
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
  
	  // Determine if we should show all items
	  const showAll = req.query.showall === 'true';
  
	  let expired = [];
	  let expiringToday = [];
	  let expiringSoon = [];
  
	  // Only filter if not showing all
	  if (!showAll) {
		expired = items.filter(item => item.expiry_date < today);
		expiringToday = items.filter(item => item.expiry_date === today);
		expiringSoon = items.filter(item => item.expiry_date === tomorrow);
	  }
  
	  const fridgeCounts = {};
	  items.forEach(item => {
		if (fridgeCounts[item.fridge]) {
		  fridgeCounts[item.fridge]++;
		} else {
		  fridgeCounts[item.fridge] = 1;
		}
	  });
  
	  // Pass showAll and items to the template
	  res.render('monitor', { expired, expiringToday, expiringSoon, fridgeCounts, deleted: req.query.deleted, showAll, items });
	});
  });

// Delete Item
app.post('/delete-item/:id', (req, res) => {
	const id = req.params.id;
	const from = req.query.from; // <-- Get the optional 'from' parameter
  
	db.get(`SELECT image_path FROM items WHERE id = ?`, [id], (err, row) => {
	  if (err) {
		console.error('Error fetching item:', err.message);
		return res.status(500).send('Database error occurred.');
	  }
  
	  if (row) {
		fs.unlink(row.image_path, (err) => {
		  if (err) {
			console.error('Error deleting image file:', err.message);
		  }
		  db.run(`DELETE FROM items WHERE id = ?`, [id], function(err) {
			if (err) {
			  console.error('Error deleting item:', err.message);
			  return res.status(500).send('Database error occurred.');
			}
			// If from=my-items, redirect there, else monitor
			if (from === 'my-items') {
			  res.redirect('/my-items?deleted=true');
			} else {
			  res.redirect('/monitor?deleted=true');
			}
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
  
	// Handle 'admin' hidden command
	if (inputUsername.toLowerCase() === 'admin') {
	  // Fetch all distinct usernames from items table
	  db.all(`SELECT DISTINCT username FROM items`, [], (err, rows) => {
		if (err) {
		  console.error('Error fetching usernames:', err.message);
		  return res.status(500).render('my-items', { error: 'Database error occurred.', items: undefined, usernames: undefined, selectedUsername: undefined });
		}
		if (rows.length === 0) {
		  // No users found
		  return res.render('my-items', { error: 'No users found in the database.', items: undefined, usernames: undefined, selectedUsername: undefined });
		} else if (rows.length === 1) {
		  // Only one user in the db, show their items directly
		  const username = rows[0].username;
		  db.all(`SELECT * FROM items WHERE username = ?`, [username], (err, items) => {
			if (err) {
			  console.error('Error fetching items:', err.message);
			  return res.status(500).render('my-items', { error: 'Database error occurred.', items: undefined, usernames: undefined, selectedUsername: undefined });
			}
			res.render('my-items', { error: undefined, items, usernames: undefined, selectedUsername: username });
		  });
		} else {
		  // Multiple usernames, display list
		  const usernames = rows.map(row => row.username);
		  res.render('my-items', { error: undefined, items: undefined, usernames, selectedUsername: undefined });
		}
	  });
	  return; // Stop here for admin case
	}
  
	// Handle 'monitor' hidden command
	if (inputUsername.toLowerCase() === 'monitor') {
	  // Redirect to monitor with showall=true
	  return res.redirect('/monitor?showall=true');
	}
  
	// Normal behavior otherwise
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
  
	  // If showall=true, we will render all items at once
	  const showAll = req.query.showall === 'true';
  
	  // Only filter if not showing all
	  let expired = [];
	  let expiringToday = [];
	  let expiringSoon = [];
	  if (!showAll) {
		expired = items.filter(item => item.expiry_date < today);
		expiringToday = items.filter(item => item.expiry_date === today);
		expiringSoon = items.filter(item => item.expiry_date === tomorrow);
	  }
  
	  const fridgeCounts = {};
	  items.forEach(item => {
		if (fridgeCounts[item.fridge]) {
		  fridgeCounts[item.fridge]++;
		} else {
		  fridgeCounts[item.fridge] = 1;
		}
	  });
  
	  res.render('monitor', { expired, expiringToday, expiringSoon, fridgeCounts, deleted: req.query.deleted, showAll, items });
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
