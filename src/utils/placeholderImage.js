import fs from 'fs';
import path from 'path';

/**
 * Generate a simple placeholder PNG image
 * Creates a gray rectangle with optional text label
 */
export class PlaceholderImageGenerator {
  /**
   * Create a minimal valid PNG file (1x1 pixel, gray)
   * This is the smallest valid PNG that works with LaTeX
   */
  static getMinimalPNG() {
    // Minimal 1x1 gray PNG (base64 decoded)
    const pngData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, // IHDR length
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, // width = 1
      0x00, 0x00, 0x00, 0x01, // height = 1
      0x08, 0x02,             // bit depth = 8, color type = 2 (RGB)
      0x00, 0x00, 0x00,       // compression, filter, interlace
      0x90, 0x77, 0x53, 0xDE, // IHDR CRC
      0x00, 0x00, 0x00, 0x0C, // IDAT length
      0x49, 0x44, 0x41, 0x54, // IDAT
      0x08, 0xD7, 0x63, 0xF8, // compressed data (gray pixel)
      0xCF, 0xC0, 0xF0, 0x1F,
      0x00, 0x05, 0xFE, 0x03,
      0xFE, 0xDC, 0xCC, 0x59, // IDAT CRC
      0x00, 0x00, 0x00, 0x00, // IEND length
      0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82  // IEND CRC
    ]);
    return pngData;
  }

  /**
   * Create a placeholder image file
   * @param {string} outputPath - Path to save the placeholder image
   * @param {string} label - Optional label text (embedded in filename)
   * @returns {string} Path to the created image
   */
  static async createPlaceholder(outputPath, label = 'placeholder') {
    const dir = path.dirname(outputPath);
    await fs.promises.mkdir(dir, { recursive: true });

    const pngData = this.getMinimalPNG();
    await fs.promises.writeFile(outputPath, pngData);

    return outputPath;
  }

  /**
   * Find all placeholder references in LaTeX content and create the images
   * @param {string} latexContent - LaTeX content with \includegraphics commands
   * @param {string} outputDir - Directory to create placeholder images in
   * @returns {Promise<string[]>} List of created image paths
   */
  static async createPlaceholdersForLatex(latexContent, outputDir) {
    const createdPaths = [];
    
    // Match all \includegraphics{filename} patterns
    const includeGraphicsRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
    let match;

    while ((match = includeGraphicsRegex.exec(latexContent)) !== null) {
      const filename = match[1];
      
      // Skip if file already exists
      let imagePath = path.join(outputDir, filename);
      if (!path.isAbsolute(filename)) {
        imagePath = path.join(outputDir, filename);
      } else {
        imagePath = filename;
      }

      // Add .png extension if not present
      if (!path.extname(imagePath)) {
        imagePath += '.png';
      }

      try {
        await fs.promises.access(imagePath);
        // File exists, skip
        continue;
      } catch {
        // File doesn't exist, create placeholder
        await this.createPlaceholder(imagePath, filename);
        createdPaths.push(imagePath);
        console.log(`[PlaceholderImage] Created placeholder: ${imagePath}`);
      }
    }

    return createdPaths;
  }
}

export default PlaceholderImageGenerator;
