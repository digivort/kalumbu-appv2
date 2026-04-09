/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Project: AgriChain Zambia
 * Developer: Tulumba Desmond (Digivort Technologies)
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS classes while resolving conflicts.
 * * clsx: Handles conditional class logic (e.g., active ? 'bg-green-500' : 'bg-gray-50').
 * twMerge: Ensures that later Tailwind classes override earlier ones (e.g., 'px-2 px-4' becomes 'px-4').
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}