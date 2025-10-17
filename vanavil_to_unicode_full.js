// ✅ Use CommonJS imports for Node compatibility
const XLSX = require("xlsx");
const fs = require("fs");

// 🔹 Vanavil → Unicode Tamil converter
function convertVanavilToUnicode(text) {
  if (!text) return "";
  let t = text;

  // --- Replace Vanavil encoded characters ---
  const map = {
    "ÂU.": "திரு.",
    "m": "அ", "M": "ஆ", "¢": "இ", "£": "ஈ", "¤": "உ", "¥": "ஊ",
    "§": "எ", "¨": "ஏ", "©": "ஐ", "ª": "ஒ", "«": "ஓ", "¬": "ஔ",
    "C": "க", "c": "ங", "J": "ச", "j": "ஞ", "E": "ட", "e": "ண",
    "G": "த", "g": "ந", "T": "ப", "t": "ம", "N": "ய", "n": "ர",
    "b": "ல", "v": "வ", "I": "ழ", "i": "ள", "u": "ற", "U": "ன",
    "h": "ா", "p": "ி", "P": "ீ", "q": "ு", "Q": "ூ", "r": "ெ", "R": "ே",
    "F": "ை", "V": "ொ", "W": "ோ", "x": "்",
  };

  for (const [k, v] of Object.entries(map)) {
    const re = new RegExp(k, "g");
    t = t.replace(re, v);
  }

  // Cleanup unwanted characters
  t = t.replace(/[^\u0B80-\u0BFF\s\.]/g, "");
  return t.trim();
}

// 🔹 Read Excel
const workbook = XLSX.readFile("vanavil_data.xlsx");
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

const output = data.map((row) => ({
  Branch: convertVanavilToUnicode(row["Branch(kilai)"]),
  Name: convertVanavilToUnicode(row["Name"]),
}));

// 🔹 Write converted file
const newSheet = XLSX.utils.json_to_sheet(output);
const newBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newBook, newSheet, "Converted");
XLSX.writeFile(newBook, "converted_tamil.xlsx");

console.log("✅ Conversion complete → converted_tamil.xlsx created!");
