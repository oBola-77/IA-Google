import { useState, useEffect } from 'react';

export const useCalibration = () => {
    const [calibrationPoints, setCalibrationPoints] = useState([]); // [{x,y}, {x,y}]
    const [realDistanceInput, setRealDistanceInput] = useState(''); // User input string
    const [scaleFactor, setScaleFactor] = useState(null); // pixels per mm

    // Load saved scale factor if available (could be per model later)
    useEffect(() => {
        const saved = localStorage.getItem('smart_inspector_scale_factor');
        if (saved) setScaleFactor(parseFloat(saved));
    }, []);

    const addCalibrationPoint = (x, y) => {
        setCalibrationPoints(prev => {
            if (prev.length >= 2) return [{ x, y }]; // Reset and start new line
            return [...prev, { x, y }];
        });
    };

    const computeScaleFactor = () => {
        if (calibrationPoints.length !== 2) return null;
        const distMm = parseFloat(realDistanceInput);
        if (!distMm || isNaN(distMm) || distMm <= 0) return null;

        const p1 = calibrationPoints[0];
        const p2 = calibrationPoints[1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const pixelDist = Math.sqrt(dx * dx + dy * dy);

        const factor = pixelDist / distMm; // pixels per mm (e.g., 10px = 1mm)

        setScaleFactor(factor);
        localStorage.setItem('smart_inspector_scale_factor', factor.toString());
        return factor;
    };

    const resetCalibration = () => {
        setCalibrationPoints([]);
        setRealDistanceInput('');
    };

    const getPixelDistance = () => {
        if (calibrationPoints.length !== 2) return 0;
        const p1 = calibrationPoints[0];
        const p2 = calibrationPoints[1];
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    };

    return {
        calibrationPoints,
        addCalibrationPoint,
        realDistanceInput,
        setRealDistanceInput,
        scaleFactor,
        computeScaleFactor,
        resetCalibration,
        getPixelDistance
    };
};
