import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Navigation = () => {
  const location = useLocation();
  
  return (
    <nav className="nav-bar">
      <Link 
        to="/" 
        className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
      >
        Home
      </Link>
      <Link 
        to="/visualization" 
        className={`nav-link ${location.pathname === '/visualization' ? 'active' : ''}`}
      >
        Visualization
      </Link>
      <Link 
        to="/editor" 
        className={`nav-link ${location.pathname === '/editor' ? 'active' : ''}`}
      >
        Image Editor
      </Link>
    </nav>
  );
};

export default Navigation; 