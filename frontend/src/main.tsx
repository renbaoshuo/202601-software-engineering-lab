import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import '@mantine/core/styles.css';
import './styles.css';
import App from './App';

const router = createBrowserRouter([{ path: '/', Component: App }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
