import { Events } from "@/components/events"
import { LanguageProvider } from '@/components/language-provider';


export default function Page() {
  return (
    <LanguageProvider>
      <Events />
    </LanguageProvider>
  );
}