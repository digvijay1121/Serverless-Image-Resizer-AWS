// =============================
// CONFIGURATION
// =============================
const BUCKET_NAME = "image-resizer-bucket-20263";
const REGION = "ap-south-1";
const BUCKET_URL = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com`;
const MAX_FILE_SIZE_MB = 100;

const ALLOWED_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp"
];

const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 60000;

// =============================
// DOM ELEMENTS
// =============================
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const progressContainer = document.getElementById("progressContainer");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const uploadSpeed = document.getElementById("uploadSpeed");
const errorBox = document.getElementById("errorBox");
const spinner = document.getElementById("spinner");
const successBox = document.getElementById("successBox");
const previewSection = document.getElementById("previewSection");
const originalImage = document.getElementById("originalImage");
const resizedImage = document.getElementById("resizedImage");
const downloadBtn = document.getElementById("downloadBtn");
const browseBtn = document.getElementById("browseBtn");
const uploadAnother = document.getElementById("uploadAnother");
const actionButtons = document.getElementById("actionButtons");
const statsCard = document.getElementById("statsCard");

// Meta Data UI Fields
const originalName = document.getElementById("originalName");
const originalSize = document.getElementById("originalSize");
const originalResolution = document.getElementById("originalResolution");
const resizedSize = document.getElementById("resizedSize");
const compressionRatio = document.getElementById("compressionRatio");
const savedSpace = document.getElementById("savedSpace");
const processingTime = document.getElementById("processingTime");

let isUploading = false;
let uploadStartTime = 0;

// =============================
// UI UTILITIES
// =============================
function show(element) { if(element) element.classList.remove("hidden"); }
function hide(element) { if(element) element.classList.add("hidden"); }

function resetUI() {
    hide(errorBox);
    hide(successBox);
    hide(spinner);
    hide(previewSection);
    hide(progressContainer);
    hide(statsCard);
    hide(actionButtons);
    progressFill.style.width = "0%";
    progressLabel.innerText = "Uploading... 0%";
}

function showError(message) {
    errorBox.innerText = "⚠ " + message;
    show(errorBox);
    hide(progressContainer);
    hide(spinner);
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// =============================
// EVENT INTERACTION
// =============================
browseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
});

dropZone.addEventListener("click", () => { fileInput.click(); });
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => { dropZone.classList.remove("dragover"); });
dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if(file) handleFile(file);
});

fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if(file) handleFile(file);
});

uploadAnother.addEventListener("click", resetUI);

// =============================
// PROCESSING & VALIDATION
// =============================
function handleFile(file) {
    if(isUploading) {
        showError("An upload is already running.");
        return;
    }
    resetUI();

    if(file.size === 0) {
        showError("Selected file is empty.");
        return;
    }
    if(!ALLOWED_TYPES.includes(file.type)) {
        showError("Only PNG, JPG and WEBP are allowed.");
        return;
    }
    const sizeInMB = file.size / (1024 * 1024);
    if(sizeInMB > MAX_FILE_SIZE_MB) {
        showError(`Image must be under ${MAX_FILE_SIZE_MB} MB.`);
        return;
    }

    // Populate metadata UI fields for Original Image
    originalName.innerText = file.name;
    originalSize.innerText = formatBytes(file.size);
    
    // Calculate Client Image Dimensions asynchronously
    const img = new Image();
    img.onload = function() {
        originalResolution.innerText = `${this.width} × ${this.height}`;
    };
    img.src = URL.createObjectURL(file);

    uploadFile(file);
}

function uploadFile(file) {
    isUploading = true;
    uploadStartTime = Date.now();
    show(progressContainer);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${Date.now()}-${safeName}`;
    const uploadUrl = `${BUCKET_URL}/uploads/${key}`;
    const resizedUrl = `${BUCKET_URL}/resized/${key}`;
    const preview = URL.createObjectURL(file);

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
        if(event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            progressFill.style.width = percent + "%";
            progressLabel.innerText = `Uploading... ${percent}%`;
            
            const elapsedSeconds = (Date.now() - uploadStartTime) / 1000;
            if (elapsedSeconds > 0) {
                const speed = (event.loaded / (1024 * 1024)) / elapsedSeconds;
                uploadSpeed.innerText = `Speed: ${speed.toFixed(2)} MB/s`;
            }
        }
    };

    xhr.onload = () => {
        isUploading = false;
        if(xhr.status === 200 || xhr.status === 204) {
            hide(progressContainer);
            originalImage.src = preview;
            show(spinner);
            pollForResizedImage(resizedUrl, preview, file.size);
        } else {
            showError(`Upload failed (HTTP ${xhr.status})`);
        }
    };

    xhr.onerror = () => {
        isUploading = false;
        showError("Network error occurred while uploading.");
    };

    xhr.send(file);
}

function pollForResizedImage(resizedUrl, preview, originalBytes) {
    const startTime = Date.now();

    const interval = setInterval(async () => {
        if(Date.now() - startTime > POLL_TIMEOUT) {
            clearInterval(interval);
            hide(spinner);
            showError("Image resizing timed out. Check Lambda configuration and CloudWatch logs.");
            return;
        }

        try {
            const response = await fetch(resizedUrl + "?t=" + Date.now(), { method: "HEAD" });
            if(response.ok) {
                clearInterval(interval);
                hide(spinner);
                
                // Read Content-Length Header for metrics tracking
                const resizedBytes = response.headers.get("Content-Length") || Math.round(originalBytes * 0.35); 
                const processDuration = ((Date.now() - startTime) / 1000).toFixed(1);

                showSuccess(resizedUrl, preview, originalBytes, parseInt(resizedBytes), processDuration);
            }
        } catch(error) {
            console.log("Waiting for Lambda execution workflow...");
        }
    }, POLL_INTERVAL);
}

// =============================
// METRICS DISPLAY SUCCESS
// =============================
function showSuccess(resizedUrl, preview, origSize, newSize, duration) {
    originalImage.src = preview;
    resizedImage.src = resizedUrl + "?t=" + Date.now();
    
    downloadBtn.href = resizedUrl;
    downloadBtn.download = "resized-image.jpg";

    // Metrics parsing transformations
    resizedSize.innerText = formatBytes(newSize);
    const savings = Math.max(0, ((origSize - newSize) / origSize) * 100);
    compressionRatio.innerText = `-${savings.toFixed(0)}%`;
    savedSpace.innerText = formatBytes(Math.max(0, origSize - newSize));
    processingTime.innerText = `${duration}s`;

    show(downloadBtn);
    show(previewSection);
    show(statsCard);
    show(actionButtons);
    show(successBox);
}