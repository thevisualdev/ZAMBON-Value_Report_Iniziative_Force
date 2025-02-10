import React from 'react';
import { Link } from 'react-router-dom';
import './LandingPage.css';

const LandingPage = () => {
  return (
    <div className="landing-container">
      <h1>Welcome to Visualization Tool</h1>
      <div className="button-container">
        <Link to="/visualization" className="landing-button">
          Interactive Visualization
        </Link>
        <Link to="/editor" className="landing-button">
          Image Editor
        </Link>
      </div>
    </div>
  );
};

export default LandingPage; 