const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sharp = require('sharp'); // <-- Sharp importieren

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Configuration
const IMAGES_DIR = path.join(__dirname, 'images');
const OUTPUT_DIR = path.join(__dirname, 'output');
const AI_API_URL = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'gemma3:12b';

// Ensure directories exist
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Helper function to get image files from directory
function getImageFiles() {
    const files = fs.readdirSync(IMAGES_DIR);
    return files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
    });
}

// Helper function to read existing metadata for an image
function getImageMetadata(imageName) {
    const metadataPath = path.join(OUTPUT_DIR, `${path.parse(imageName).name}.json`);
    if (fs.existsSync(metadataPath)) {
        try {
            return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch (error) {
            console.error(`Error reading metadata for ${imageName}:`, error);
            return { regions: [], results: [] };
        }
    }
    return { regions: [], results: [] };
}

// Helper function to save metadata for an image
function saveImageMetadata(imageName, metadata) {
    const metadataPath = path.join(OUTPUT_DIR, `${path.parse(imageName).name}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

// API Routes

// Get list of all images
app.get('/api/images', (req, res) => {
    try {
        const images = getImageFiles();
        const imagesWithMetadata = images.map(image => {
            const metadata = getImageMetadata(image);
            return {
                name: image,
                path: `/api/image/${image}`,
                metadata
            };
        });
        res.json(imagesWithMetadata);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a specific image
app.get('/api/image/:imageName', (req, res) => {
    try {
        const imageName = req.params.imageName;
        const imagePath = path.join(IMAGES_DIR, imageName);
        
        if (!fs.existsSync(imagePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = `data:image/${path.extname(imageName).substring(1)};base64,${imageBuffer.toString('base64')}`;
        
        res.json({ image: base64Image });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save regions for an image
app.post('/api/image/:imageName/regions', (req, res) => {
    try {
        const imageName = req.params.imageName;
        const { regions } = req.body;
        
        if (!Array.isArray(regions)) {
            return res.status(400).json({ error: 'Regions must be an array' });
        }
        
        const metadata = getImageMetadata(imageName);
        metadata.regions = regions;
        saveImageMetadata(imageName, metadata);
        
        res.json({ success: true, regions: metadata.regions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Add this temporary endpoint to test
app.get('/api/test-ollama', async (req, res) => {
    try {
		
		 const response = await fetch(AI_API_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                model:"qwen2.5vl:7b",
                                prompt:"Hey",
                                stream: false,
                                keep_alive: 10
                                //images: [regionBase64]
                            })
                        });
						
        
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
		console.log("data",data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Process all images with OCR
app.post('/api/process-all', async (req, res) => {
    try {
        const { model = DEFAULT_MODEL, prompts } = req.body;
        
        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
            return res.status(400).json({ error: 'At least one prompt is required' });
        }
        
        const images = getImageFiles();
        const results = [];
        
        for (const imageName of images) {
            const metadata = getImageMetadata(imageName);
            const imagePath = path.join(IMAGES_DIR, imageName);
            
            // Initialize results array if it doesn't exist
            if (!metadata.results) {
                metadata.results = [];
            }
            
            // Process each region with each prompt
            for (const region of metadata.regions) {
                // Use sharp to extract the region from the original image
				console.log("region",region);
                try {
					// Get the original image format
					const originalFormat = path.extname(imageName).substring(1).toLowerCase();
                    const imageBuffer = fs.readFileSync(imagePath);
                    const regionBuffer = await sharp(imageBuffer)
                        .extract({ 
                            left: 	Math.round(region.x), 
                            top: 	Math.round(region.y), 
                            width: 	Math.round(region.width), 
                            height: Math.round(region.height) 
                        }).toBuffer();
					console.log(`Cropping region for ${imageName}:`, region);
					console.log(`Original format: ${originalFormat}, Cropped buffer size: ${regionBuffer.length} bytes`);
                    // Convert the cropped region buffer to base64
					const regionBase64 = regionBuffer.toString('base64');
					console.log("prompts",prompts);
                    for (const prompta of prompts) {
                        try {
							console.log("prompt",prompta);
							console.log("model",model);
                            const response = await fetch(AI_API_URL, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
									model:model,
									prompt:prompta,
									stream: false,
									keep_alive: 30,
									images: [regionBase64]
								})
                            });
                            
                            if (!response.ok) {
                                throw new Error(`API request failed with status ${response.status}`);
                            }
                            
                            const data = await response.json();
							console.log("data",data);
                            const resultText = data.response || 'No response received from AI';
                            
                            // Save the result
                            const result = {
                                region: region,
                                prompt: prompta,
                                response: resultText,
                                timestamp: new Date().toISOString()
                            };
                            
                            metadata.results.push(result);
                            
                            // Also save the result as a text file
                            const resultFileName = `${path.parse(imageName).name}_region_${region.x}_${region.y}_${region.width}_${region.height}_${Date.now()}.txt`;
                            const resultFilePath = path.join(OUTPUT_DIR, resultFileName);
                            fs.writeFileSync(resultFilePath, `Prompt: ${prompta}\n\nResponse:\n${resultText}`);
                            
                            results.push({
                                image: imageName,
                                region,
                                prompta,
                                response: resultText,
                                file: resultFileName
                            });
                        } catch (error) {
                            console.error(`Error processing ${imageName} with prompt "${prompta}":`, error);
                            results.push({
                                image: imageName,
                                region,
                                prompta,
                                error: error.message
                            });
                        }
                    }
                } catch (cropError) {
                    console.error(`Error cropping region for ${imageName}:`, cropError);
                    results.push({
                        image: imageName,
                        region,
                        error: `Failed to crop image region: ${cropError.message}`
                    });
                }
            }
            
            // Save updated metadata
            saveImageMetadata(imageName, metadata);
        }
        
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get available models from Ollama
app.get('/api/models', async (req, res) => {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Start server
app.listen(PORT, () => {
    console.log(`Image server running on http://localhost:${PORT}`);
    console.log(`Images directory: ${IMAGES_DIR}`);
    console.log(`Output directory: ${OUTPUT_DIR}`);

});
