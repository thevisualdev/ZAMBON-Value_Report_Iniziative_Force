import React, { useRef, useEffect, useState } from 'react';
import { GUI } from 'dat.gui';
import { saveAs } from 'file-saver';
import './ImageEditor.css';
import { ImageEditorGL } from '../js/imageEditorGL';

const ImageEditor = () => {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const guiRef = useRef(null);
  const [hasImage, setHasImage] = useState(false);
  const [imageData, setImageData] = useState(null);
  const [editor, setEditor] = useState(null);
  const [showGUI, setShowGUI] = useState(true);
  const [params, setParams] = useState({
    halftone: {
      radius: 3.6,
      rotateR: 1.9,
      rotateG: 5.9,
      rotateB: 0.79,
      scatter: 0.0,
      shape: 1,
      blending: 1.0,
      blendingMode: 1,
      greyscale: false,
      disable: false
    }
  });
  const [originalFileName, setOriginalFileName] = useState('');

  // Define cleanupGUI function
  const cleanupGUI = () => {
    // Remove all existing GUI instances
    const existingGUIs = document.querySelectorAll('.dg.ac');
    existingGUIs.forEach(gui => {
      gui.remove();
    });
    
    // Also destroy the GUI instance if it exists
    if (guiRef.current) {
      guiRef.current.destroy();
      guiRef.current = null;
    }
  };

  // Update the GUI creation effect:
  useEffect(() => {
    if (!hasImage) return;

    // Clean up any existing GUIs first
    cleanupGUI();

    const gui = new GUI({ 
      autoPlace: false
    });
    guiRef.current = gui;
    
    // Add class for identification
    gui.domElement.classList.add('ImageEditorGUI');
    
    document.body.appendChild(gui.domElement);
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '0';
    gui.domElement.style.right = '0';
    gui.domElement.style.zIndex = '9999';

    const halftoneFolder = gui.addFolder('Halftone Effect');
    halftoneFolder.open();

    // Update all controls to use setParams
    halftoneFolder.add(params.halftone, 'radius', 0.5, 10)
      .onChange(value => {
        setParams(prev => ({
          ...prev,
          halftone: { ...prev.halftone, radius: value }
        }));
        updateEffect();
      });

    halftoneFolder.add(params.halftone, 'rotateR', 0, Math.PI * 2)
      .onChange(value => {
        setParams(prev => ({
          ...prev,
          halftone: { ...prev.halftone, rotateR: value }
        }));
        updateEffect();
      });

    halftoneFolder.add(params.halftone, 'rotateG', 0, Math.PI * 2)
      .onChange(value => {
        setParams(prev => ({
          ...prev,
          halftone: { ...prev.halftone, rotateG: value }
        }));
        updateEffect();
      });

    halftoneFolder.add(params.halftone, 'rotateB', 0, Math.PI * 2)
      .onChange(value => {
        setParams(prev => ({
          ...prev,
          halftone: { ...prev.halftone, rotateB: value }
        }));
        updateEffect();
      });

    halftoneFolder.add(params.halftone, 'scatter', 0, 5)
      .onChange(value => {
        setParams(prev => ({
          ...prev,
          halftone: { ...prev.halftone, scatter: value }
        }));
        updateEffect();
      });

    halftoneFolder.add(params.halftone, 'shape', { 
      Dot: 1, 
      Ellipse: 2, 
      Line: 3, 
      Square: 4 
    }).onChange(value => {
      setParams(prev => ({
        ...prev,
        halftone: { ...prev.halftone, shape: value }
      }));
      updateEffect();
    });

    halftoneFolder.add(params.halftone, 'blending', 0, 1)
      .onChange(value => {
        setParams(prev => ({
          ...prev,
          halftone: { ...prev.halftone, blending: value }
        }));
        updateEffect();
      });

    halftoneFolder.add(params.halftone, 'blendingMode', { 
      Linear: 1, 
      Multiply: 2, 
      Add: 3, 
      Lighter: 4, 
      Darker: 5 
    }).onChange(value => {
      setParams(prev => ({
        ...prev,
        halftone: { ...prev.halftone, blendingMode: value }
      }));
      updateEffect();
    });

    halftoneFolder.add(params.halftone, 'greyscale')
      .onChange(value => {
        setParams(prev => ({
          ...prev,
          halftone: { ...prev.halftone, greyscale: value }
        }));
        updateEffect();
      });

    console.log('GUI setup complete'); // Debug log

    return () => {
      cleanupGUI();
      guiRef.current = null;
    };
  }, [hasImage]); // Remove showGUI dependency

  // Separate effect for GUI visibility
  useEffect(() => {
    if (guiRef.current) {
      guiRef.current.domElement.style.display = showGUI ? 'block' : 'none';
      console.log('Updated GUI visibility:', showGUI ? 'block' : 'none');
    }
  }, [showGUI]);

  // Keep the keyboard handler effect
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key.toLowerCase() === 'h') {
        console.log('H key pressed, toggling GUI...'); // Debug log
        setShowGUI(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);  // No dependencies needed for keyboard handler

  // Update the useEffect that handles the editor setup
  useEffect(() => {
    if (!hasImage || !imageData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    const maxWidth = window.innerWidth * 0.9;
    const maxHeight = window.innerHeight * 0.8;
    const scale = Math.min(
      maxWidth / imageData.width,
      maxHeight / imageData.height,
      1
    );
    
    canvas.width = imageData.width * scale;
    canvas.height = imageData.height * scale;
    
    const editorGL = new ImageEditorGL(canvas);
    editorGL.loadImage(imageData);
    editorGL.render(params); // Initial render with current params
    setEditor(editorGL);

    return () => {
      // Cleanup
      if (editor) {
        // Any necessary cleanup for editorGL
      }
    };
  }, [hasImage, imageData]);

  // Add an effect to handle param changes
  useEffect(() => {
    if (editor) {
      editor.render(params);
    }
  }, [params, editor]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Store the original file name without extension
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    setOriginalFileName(baseName);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setImageData(img);
        setHasImage(true);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const updateEffect = () => {
    if (editor) {
      requestAnimationFrame(() => {
        editor.render(params);
      });
    }
  };

  const handleExport = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob((blob) => {
      const exportName = `${originalFileName}-cmyk-halftone.png`;
      saveAs(blob, exportName);
    }, 'image/png');
  };

  const handleNewFile = () => {
    setHasImage(false);
    setImageData(null);
    setOriginalFileName('');
    // Only reset file input if it exists
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // Clean up GUI
    if (guiRef.current) {
      guiRef.current.destroy();
      guiRef.current = null;
    }
  };

  const buttonStyles = {
    export: {
      backgroundColor: '#4ECDC4',
      marginRight: '10px'
    },
    new: {
      backgroundColor: '#E83D30'
    }
  };

  return (
    <div className="editor-container">
      {!hasImage ? (
        <div className="upload-area">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".png,.jpg,.jpeg"
            style={{ display: 'none' }}
          />
          <button 
            className="upload-button"
            onClick={() => fileInputRef.current.click()}
          >
            Upload Image
          </button>
          <div className="instructions">
            Press 'H' to toggle controls
          </div>
        </div>
      ) : (
        <div className="editor-workspace">
          <canvas ref={canvasRef} />
          <div className="button-container">
            <button 
              className="export-button"
              onClick={handleExport}
            >
              Export Image
            </button>
            <button 
              className="new-file-button"
              onClick={handleNewFile}
            >
              New File
            </button>
          </div>
          <div className="instructions">
            Press 'H' to toggle controls
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageEditor; 