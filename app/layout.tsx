import './globals.css';
import { AppFooter } from './components/app-footer';

export const metadata = {
  title: 'Just Flow Intelligence',
  description: 'Just Flow ClickUp operations intelligence',
  icons: { icon: '/just-flow-192.png', apple: '/just-flow-192.png' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body suppressHydrationWarning>{children}<AppFooter /></body></html>;
}
