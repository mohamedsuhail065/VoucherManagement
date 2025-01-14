const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const { poolPromise, sql, getSettings } = require("./Model/dbConfig");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const app = express();
require("dotenv").config();
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "logged",
    resave: false,
    saveUninitialized: true,
  })
);

const validUser = { username: "admin", password: "1234" };
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

//hardcoded login method

// app.post("/login", (req, res) => {
//   const { uname, pword } = req.body;
//   if (uname === validUser.username && pword === validUser.password) {
//     req.session.user = uname;
//     res.redirect("/dashboard");
//   } else {
//     res.render("login", { error: "Invalid Credentials" });
//   }
// });

//login through Db

app.post("/login", async (req, res) => {
  const { uname, pword } = req.body;

  try {
    const pool = await poolPromise; 
    if (!pool) {
      throw new Error("Database connection failed");
    }

    const result = await pool
      .request()
      .input("username", sql.VarChar, uname) 
      .query("SELECT * FROM Users");

    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      if (pword === user.password) {
        req.session.user = uname; // Store session
        return res.redirect("/dashboard");
      }
    }

    res.render("login", { error: "Invalid username or password" });
  } catch (err) {
    console.error("Error during login:", err);
    res.render("login", {
      error: "An error occurred, please try again later.",
    });
  }
});

app.get("/dashboard", async (req, res) => {
  if (req.session.user) {
    try {
      const pool = await poolPromise;
      const result = await pool.request().query("SELECT * FROM vouchers");
      const vouchers = result.recordset; // Get the array of rows
      res.render("dashboard", { user: req.session.user, vouchers });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error fetching vouchers");
    }
  } else {
    res.redirect("/login");
  }
});

app.post("/generate-qrcode", async (req, res) => {
  const settings = await getSettings();
  const expiryTime = settings.expiry_time;
  const randomnumber = Math.floor(1000000000 + Math.random() * 9000000000);
  const gmt4Date = new Date();
  const expiryDate = new Date(gmt4Date);
  expiryDate.setHours(expiryDate.getHours() + expiryTime);

  QRCode.toDataURL(randomnumber.toString(), async (err, url) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Error Creating QR code" });
    }

    const query = `
        INSERT INTO vouchers (number, generated_date, expiry_date, qr_code)
        VALUES (@number, @generatedDate, @expiryDate, @qrCode)
      `;

    try {
      const pool = await poolPromise; 
      await pool
        .request()
        .input("number", sql.BigInt, randomnumber)
        .input("generatedDate", sql.DateTime, gmt4Date)
        .input("expiryDate", sql.DateTime, expiryDate)
        .input("qrCode", sql.NVarChar, url)
        .query(query);

      res.status(200).json({ message: "QR Code generated successfully!" });
    } catch (dbErr) {
      console.error(dbErr);
      return res.status(500).json({ message: "Error saving voucher" });
    }
  });
});

app.get("/export-pdf/:id", async (req, res) => {
  const settings = await getSettings();
  const voucherId = req.params.id;
  const pool = await poolPromise;
  const result = await pool
    .request()
    .query(`SELECT * FROM vouchers WHERE id=${voucherId}`);
  const voucher = result.recordset[0];
  const doc = new PDFDocument({
    size: "A4", // Standard page size
    layout: "portrait",
    margin: 50, // Margins for a neat border
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=voucher.pdf");

  // Pipe the PDF to the response
  doc.pipe(res);

  // Title Section
  doc
    .fontSize(settings.title_font_size)
    .font("Helvetica-Bold")
    .text("Voucher Details", { align: "center", underline: true })

  // QR Code Section
  if (voucher.qr_code) {
    const qrCodeWidth = settings.voucher_width * 2.83465;
    const qrCodeHeight = settings.voucher_height * 2.83465;
    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const qrCodeX = (pageWidth - qrCodeWidth) / 2 + doc.page.margins.left;
    const qrCodeY = doc.y; // Current vertical position for QR code

    doc.image(voucher.qr_code, qrCodeX, qrCodeY, {
      width: qrCodeWidth,
      height: qrCodeHeight,
    });
  } else {
    doc.text("QR Code: Not available", { align: "center" });
  }

  // Add some spacing below the QR code
  doc.moveDown(settings.voucher_height/10);

  const detailBoxWidth = 300; // Width of the box
  const detailBoxHeight = 70; // Height of the box
  const detailBoxX =
    (doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right -
      detailBoxWidth) /
      2 +
    doc.page.margins.left; // Horizontally center the box
  const detailBoxY = doc.y; // Current vertical position for the box

  // Draw the box
  doc.rect(detailBoxX, detailBoxY, detailBoxWidth, detailBoxHeight).stroke();

  // Add details inside the box
  const padding = 10; 
  let textY = detailBoxY + padding;
  const formatDate = (date) => {
    const options = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "Asia/Dubai", // GMT+4
    };
    return new Intl.DateTimeFormat("en-US", options).format(date);
  };

  doc
    .fontSize(settings.text_font_size)
    .font("Helvetica")
    .text(`Number: ${voucher.number}`, detailBoxX + padding, textY)
    .moveDown(0.5);
  textY += 20;
  doc.text(
    `Generated Date: ${formatDate(voucher.generated_date)}`,
    detailBoxX + padding,
    textY
  );
  textY += 20;
  doc.text(
    `Expiry Date: ${formatDate(voucher.expiry_date)}`,
    detailBoxX + padding,
    textY
  );

  // Footer Section
  const footerText = "Thank you for using our service!";
  const footerWidth = doc.widthOfString(footerText); // Get the text width
  const footerX = (doc.page.width - footerWidth) / 2; // Horizontally center the footer
  const footerY = doc.page.height - doc.page.margins.bottom - 30; // 30px above the bottom margin

  doc
    .moveDown(8)
    .fontSize(12)
    .font("Helvetica-Oblique")
    .text(footerText, footerX, footerY);

  // Finalize the PDF
  doc.end();
});

app.get("/settings", async (req, res) => {
  if (req.session.user) {
    try {
      const settings = await getSettings();
      res.render("settings", { settings, message: "" });
    } catch (error) {
      console.log(error);
    }
  } else {
    res.redirect("/login");
  }
});

app.post("/settings", async (req, res) => {
  const {
    expiry_time,
    voucher_width,
    voucher_height,
    title_font_size,
    text_font_size,
  } = req.body;
  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input("expiry_time", sql.Int, expiry_time)
      .input("voucher_width", sql.Float, voucher_width)
      .input("voucher_height", sql.Float, voucher_height)
      .input("title_font_size", sql.Int, title_font_size)
      .input("text_font_size", sql.Int, text_font_size)
      .query(
        `UPDATE settings SET 
          expiry_time = @expiry_time, 
          voucher_width = @voucher_width, 
          voucher_height = @voucher_height, 
          title_font_size = @title_font_size, 
          text_font_size = @text_font_size`
      );
    // Pass the settings object with a success message
    const updatedSettings = {
      expiry_time,
      voucher_width,
      voucher_height,
      title_font_size,
      text_font_size,
    };
    res.render("settings", {
      settings: updatedSettings,
      message: "Settings saved successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating settings");
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.listen(3000, () => console.log("server running on port 3000"));
