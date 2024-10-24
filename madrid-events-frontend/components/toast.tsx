import React, { useEffect } from 'react';

// Definir la interfaz para los props
interface ToastProps {
  message: string;
  isVisible: boolean;
  onHide: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, isVisible, onHide }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onHide();
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [isVisible, onHide]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-md shadow-lg z-50 animate-fade-in-down">
      {message}
    </div>
  );
};

export default Toast;
