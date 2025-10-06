const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sharp = require('sharp');

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
const DEFAULT_PARALLEL_REQUESTS = 1;
let MAX_PARALLEL_REQUESTS=DEFAULT_PARALLEL_REQUESTS ;

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
console.log("metadata",metadata);		
        metadata.regions = regions;
        saveImageMetadata(imageName, metadata);
        
        res.json({ success: true, regions: metadata.regions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Process all images with OCR
// Process all images with OCR
app.post('/api/process-all', async (req, res) => {
    try {
        const { model = DEFAULT_MODEL, prompts, parallelRequests = MAX_PARALLEL_REQUESTS } = req.body;

        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
            return res.status(400).json({ error: 'At least one prompt is required' });
        }

        const maxParallel = Math.min(8, Math.max(1, parseInt(parallelRequests) || MAX_PARALLEL_REQUESTS));

        const images = getImageFiles();
        const results = [];
        const completedResults = [];

        const processingQueue = [];

        for (const imageName of images) {
            const metadata = getImageMetadata(imageName);
            const imagePath = path.join(IMAGES_DIR, imageName);
            const imageBuffer = fs.readFileSync(imagePath);

            if (!metadata.results) {
                metadata.results = [];
            }

            for (const region of metadata.regions) {
                for (const prompt of prompts) {
                    processingQueue.push({
                        imageName,
                        imagePath,
                        imageBuffer,
                        region,
                        prompt,
                        metadata
                    });
                }
            }
        }

        console.log(`Total processing tasks: ${processingQueue.length}`);
        console.log(`Max parallel requests: ${maxParallel}`);

        // Diese Funktion bleibt wie sie ist
        const createFetchRequest = async (task) => {
            const { imageName, imagePath, imageBuffer, region, prompt, metadata } = task;

            try {
                const originalFormat = path.extname(imageName).substring(1).toLowerCase();
                const regionBuffer = await sharp(imageBuffer)
                    .extract({
                        left: Math.round(region.x),
                        top: Math.round(region.y),
                        width: Math.round(region.width),
                        height: Math.round(region.height)
                    }).toBuffer();

                const regionBase64 = regionBuffer.toString('base64');

                const response = await fetch(AI_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        prompt: prompt,
                        stream: false,
                        keep_alive: 300,
                        images: [regionBase64]
                    })
                });

                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }

                const data = await response.json();
                const resultText = data.response || 'No response received from AI';

                const resultData = {
                    region,
                    prompt,
                    response: resultText,
                    model,
                    timestamp: new Date().toISOString()
                };

                metadata.results.push(resultData);

                const resultFileName = `${path.parse(imageName).name}_region_${region.x}_${region.y}_${region.width}_${region.height}_${Date.now()}.txt`;
                const resultFilePath = path.join(OUTPUT_DIR, resultFileName);
                fs.writeFileSync(resultFilePath, `Model: ${model}\nPrompt: ${prompt}\n\nResponse:\n${resultText}`);

                return {
                    success: true,
                    image: imageName,
                    region,
                    prompt,
                    response: resultText,
                    model,
                    file: resultFileName,
                    metadata
                };
            } catch (error) {
                console.error(`Error processing ${imageName}, region (${region.x},${region.y}), prompt "${prompt}":`, error);
                return {
                    success: false,
                    image: imageName,
                    region,
                    prompt,
                    response:"Error",
                    model,
                    error: error.message,
                    metadata
                };
            }
        };

        // === NEU: Concurrency Pattern ===
        let currentIndex = 0;

        async function next() {
            if (currentIndex >= processingQueue.length) return;

            const index = currentIndex++;
            const task = processingQueue[index];
            const result = await createFetchRequest(task);
            completedResults.push(result);

            if (result.success) {
                results.push({
                    image: result.image,
                    region: result.region,
                    prompt: result.prompt,
                    response: result.response,
                    model: result.model,
                    file: result.file
                });
            } else {
                results.push({
                    image: result.image,
                    region: result.region,
                    prompt: result.prompt,
                    response: result.response,
                    model: result.model,
                    error: result.error
                });
            }

            // Starte den nächsten Task
            await next();
        }

        // Starte maxParallel viele "Worker"
        const workers = [];
        for (let i = 0; i < maxParallel; i++) {
            workers.push(next());
        }

        await Promise.all(workers);

        // Metadaten speichern - FIXED VERSION
        // Create a map to store the latest metadata for each image
        const metadataMap = new Map();
        
        // Collect the latest metadata for each image from completed results
        for (const result of completedResults) {
            const imageName = result.imageName || result.image;
            metadataMap.set(imageName, result.metadata);
        }
        
        // Save the metadata for each image
        for (const [imageName, metadata] of metadataMap.entries()) {
            console.log("saveImageMetadata(imageName, metadata)", imageName, metadata);
            saveImageMetadata(imageName, metadata);
        }

        res.json({ success: true, results });
    } catch (error) {
        console.error('Fehler in /api/process-all:', error);
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


app.get('/api/config/parallel-requests', (req, res) => {
    try {
        res.json({ maxParallel: MAX_PARALLEL_REQUESTS });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config/parallel-requests', (req, res) => {
    try {
        const { maxParallel } = req.body;
        
        // Validierung: Muss eine Zahl zwischen 1 und 8 sein
        if (typeof maxParallel !== 'number' || maxParallel < 1 || maxParallel > 8) {
            return res.status(400).json({ error: 'maxParallel must be a number between 1 and 8' });
        }
        
        MAX_PARALLEL_REQUESTS = maxParallel;
        console.log(`Parallel requests updated to: ${MAX_PARALLEL_REQUESTS}`);
        res.json({ success: true, maxParallel: MAX_PARALLEL_REQUESTS });
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