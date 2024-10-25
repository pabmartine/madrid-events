import dynamic from 'next/dynamic';
import { Events } from '@/components/events';
import { LanguageProvider } from '@/components/language-provider';

// Wrapping the main page component in dynamic import to disable SSR
const PageComponent = () => (
    <LanguageProvider>
      <Events />
    </LanguageProvider>
);

const Page = dynamic(() => Promise.resolve(PageComponent), { ssr: false });

export default Page;
