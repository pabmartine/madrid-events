import React from 'react'
import { AlertCircle } from 'lucide-react'

interface ErrorMessageProps {
  message: string
  colorPalette: any
}

const ErrorMessage = ({ message, colorPalette }: { message: string; colorPalette: typeof lightPalette }) => (
  <div className={`${colorPalette.errorBg} ${colorPalette.errorText} p-4 rounded-md mb-4 flex items-center`} role="alert">
    <AlertCircle className="mr-2" />
    <span>{message}</span>
  </div>
);

export default ErrorMessage