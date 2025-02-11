import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import ImageEditor from './components/ImageEditor';
import Visualization from './components/Visualization';
import Navigation from './components/Navigation';
import './styles/main.css';

function App() {
  return (
    <Router>
      <Navigation />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/visualization" element={<Visualization />} />
        <Route path="/editor" element={<ImageEditor />} />
      </Routes>
    </Router>
  );
}

export default App;
