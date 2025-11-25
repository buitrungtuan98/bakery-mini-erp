import { toast } from 'svelte-easy-toast';

export const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
  toast(message, {
    position: 'top-center',
    duration: 3000,
    theme: {
      light: {
        background: '#FFFFFF',
        color: '#333333',
        progressBar: {
          'success': '#22c55e',
          'error': '#ef4444',
          'warning': '#f59e0b',
          'info': '#3b82f6',
        }
      },
      dark: {
        background: '#333333',
        color: '#FFFFFF',
         progressBar: {
          'success': '#22c55e',
          'error': '#ef4444',
          'warning': '#f59e0b',
          'info': '#3b82f6',
        }
      }
    },
    type: type,
    closable: true,
  });
};
