import { useQuery } from '@tanstack/react-query';
import { api, type Me } from './api';

/** The signed-in user. Every page reads it from this cached query. */
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: Infinity });
