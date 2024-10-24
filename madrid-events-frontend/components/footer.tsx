import React from 'react'
import { Linkedin, Github } from 'lucide-react'
import { useIntl } from 'react-intl'

interface ColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  footerText: string;
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  inputBorder: string;
  buttonBg: string;
  buttonText: string;
  buttonBorder: string;
  buttonHover: string;
  titleGradient: string;
  footerIcon: string;
}

interface FooterProps {
  colorPalette: ColorPalette
}

const Footer: React.FC<FooterProps> = ({ colorPalette }) => {
  const intl = useIntl()

  return (
    <footer className={`${colorPalette.cardBg} ${colorPalette.footerText} py-4 px-6 mt-8`}>
      <div className="w-full max-w-full flex justify-between items-center">
        <p><span className={`${colorPalette.footerIcon} hover:${colorPalette.buttonHover}`}>{intl.formatMessage({ id: 'app.footer.text' })}</span></p>
        <div className="flex space-x-4">
          <a href="https://www.linkedin.com/in/pabmartine" target="_blank" rel="noopener noreferrer" className={`${colorPalette.footerIcon} hover:${colorPalette.buttonHover}`} aria-label={intl.formatMessage({ id: 'app.linkedin.profile' })}>
            <Linkedin size={24} />
          </a>
          <a href="https://github.com/pabmartine" target="_blank" rel="noopener noreferrer" className={`${colorPalette.footerIcon} hover:${colorPalette.buttonHover}`} aria-label={intl.formatMessage({ id: 'app.github.profile' })}>
            <Github size={24} />
          </a>
        </div>
      </div>
    </footer>
  )
}

export default Footer