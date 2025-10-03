```project/
├── image-server.js
├── package.json
├── images/         # Place your images here
├── output/         # Results will be saved here
└── public/         # Create this folder and place the HTML file here as index.html
```
# Coded with AI
Qwen3 Coder
Qwen3 WebDev
Z.ai GLM 4.6

# Install
``npm install``
# Start the server
``node image-server.js``
# Access the web interface:
Open your browser and go to http://localhost:3000
     
# Features 
## Web Interface: 

     Image Grid View: Shows all images from the images directory
     Region Editor: Click on any image to open the region selector
     Multiple Regions: Define multiple regions per image
     Batch Processing: Process all images with multiple prompts
     Real-time Statistics: Track total images, regions, and processed images
     Visual Feedback: See which images have regions and results
     

## Region Selection: 

     Drag to Select: Click and drag to create a selection
     Resize Handles: Drag corners to resize selections
     Move Selections: Drag inside selection to move
     Precise Control: Enter exact dimensions
     Multiple Regions: Save multiple regions per image
     

## Batch Processing: 

     Multiple Prompts: Add multiple OCR prompts
     Model Selection: Choose from available Ollama models
     Progress Tracking: Real-time processing log
     Error Handling: See which images failed and why
     

## Data Storage: 

     JSON Metadata: Each image has a corresponding JSON file with regions and results
     Text Files: OCR results saved as individual text files
     Persistent Storage: All data persists between sessions
     

The interface provides a complete workflow for batch OCR processing with region selection, making it easy to process multiple images with specific areas of interest. 
