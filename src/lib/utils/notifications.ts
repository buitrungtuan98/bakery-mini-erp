import { toast } from 'svelte-sonner';

export const showSuccessToast = (message: string) => {
  toast.success(message, {
    duration: 2000,
  });
};

export const showErrorToast = (message: string) => {
  toast.error(message, {
    duration: 3000,
  });
};
