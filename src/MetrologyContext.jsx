import React, { createContext, useContext, useState, useEffect } from 'react';

const MetrologyContext = createContext();

export const MetrologyProvider = ({ children }) => {
    const [isCvReady, setIsCvReady] = useState(false);

    useEffect(() => {
        // Poll for OpenCV loading
        const interval = setInterval(() => {
            if (window.cv && window.cv.Mat) { // Check for core functionality
                setIsCvReady(true);
                clearInterval(interval);
                console.log("OpenCV.js Loaded and Ready!");
            }
        }, 200);

        // Timeout safety (optional, but good for debug)
        const timeout = setTimeout(() => {
            if (!window.cv) {
                console.warn("OpenCV.js loading timed out or failed.");
            }
        }, 10000);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, []);

    return (
        <MetrologyContext.Provider value={{ isCvReady, cv: window.cv }}>
            {children}
        </MetrologyContext.Provider>
    );
};

export const useMetrology = () => useContext(MetrologyContext);
