import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // Retry only network / server errors; a 4xx will not fix itself.
    queries: { retry: (n, e) => n < 2 && (!(e instanceof ApiError) || e.status === 0 || e.status >= 500), refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
