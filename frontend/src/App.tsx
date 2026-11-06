import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HealthPage } from './pages/HealthPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/health" element={<HealthPage />} />
        <Route path="/" element={<Navigate to="/health" replace />} />
        <Route path="*" element={<Navigate to="/health" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
