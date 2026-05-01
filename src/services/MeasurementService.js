// MeasurementService.js

/**
 * Detects the centroid AND dimensions of the largest object in the ROI.
 * Returns { x, y } relative to the Video Frame.
 */
export const processMeasurement = (videoElement, region, scaleFactor) => {
    if (!window.cv || !scaleFactor) {
        return { error: 'OpenCV not ready or Scale not set' };
    }

    const cv = window.cv;
    let src = null;
    let gray = null;
    let thresh = null;
    let hierarchy = null;
    let contours = null;

    try {
        const { x, y, w, h } = region.box;

        // 0. Safety Check
        if (w <= 0 || h <= 0) return { error: 'Invalid Region' };

        // 1. Capture ROI from Video
        const capCanvas = document.createElement('canvas');
        capCanvas.width = w;
        capCanvas.height = h;
        const ctx = capCanvas.getContext('2d', { willReadFrequently: true });

        ctx.drawImage(videoElement, x, y, w, h, 0, 0, w, h);

        // 2. Load into OpenCV
        const imgData = ctx.getImageData(0, 0, w, h);
        src = cv.matFromImageData(imgData);

        // 3. Pre-processing
        gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        const ksize = new cv.Size(5, 5);
        cv.GaussianBlur(gray, gray, ksize, 0, 0, cv.BORDER_DEFAULT);

        thresh = new cv.Mat();
        cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

        // 4. Find Contours
        contours = new cv.MatVector();
        hierarchy = new cv.Mat();
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // 5. Find Largest Contour
        let maxArea = 0;
        let maxContourIndex = -1;

        for (let i = 0; i < contours.size(); ++i) {
            const cnt = contours.get(i);
            const area = cv.contourArea(cnt);
            if (area > maxArea && area > 50) {
                maxArea = area;
                maxContourIndex = i;
            }
        }

        if (maxContourIndex === -1) {
            return { status: 'empty', distancePx: 0 };
        }

        // 6. Calculate Centroid
        const cnt = contours.get(maxContourIndex);
        const M = cv.moments(cnt);

        if (M.m00 === 0) return { status: 'error' };

        const cx = M.m10 / M.m00;
        const cy = M.m01 / M.m00;

        // 7. Calculate Rotated Bounding Box (Dimensioning)
        // minAreaRect finds the smallest rotated rectangle enclosing the contour
        const rotatedRect = cv.minAreaRect(cnt);
        const { width, height } = rotatedRect.size;
        const angle = rotatedRect.angle;

        return {
            status: 'ok',
            centroid: {
                x: x + cx,
                y: y + cy
            },
            dimensionsPx: {
                width: width,
                height: height,
                angle: angle
            },
            // Pass raw rotated rect for advanced drawing if needed
            // Note: rotatedRect.center is relative to ROI. We offset it.
            rotatedRect: {
                center: { x: x + rotatedRect.center.x, y: y + rotatedRect.center.y },
                size: rotatedRect.size,
                angle: rotatedRect.angle
            },
            area: maxArea
        };

    } catch (e) {
        console.error("OpenCV Error:", e);
        return { error: e.message };
    } finally {
        if (src) src.delete();
        if (gray) gray.delete();
        if (thresh) thresh.delete();
        if (hierarchy) hierarchy.delete();
        if (contours) contours.delete();
    }
};

/**
 * Calculates Euclidean distance between two points (mm)
 */
export const calculateDistance = (p1, p2, scaleFactor) => {
    if (!p1 || !p2 || !scaleFactor) return 0;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const pxDist = Math.sqrt(dx * dx + dy * dy);
    return pxDist / scaleFactor;
};
