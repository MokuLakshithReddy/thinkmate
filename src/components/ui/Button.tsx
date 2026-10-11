import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', isLoading, children, disabled, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none rounded-lg';

    const variants = {
      default: 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700/60 shadow-xs',
      primary: 'bg-sky-600 text-white hover:bg-sky-500 shadow-sm shadow-sky-950/40 border border-sky-500/50',
      secondary: 'bg-[#162036] text-slate-200 hover:bg-[#1f2d4d] border border-slate-700/50',
      outline: 'border border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800/60 hover:text-white',
      ghost: 'bg-transparent text-slate-300 hover:bg-slate-800/60 hover:text-white',
      danger: 'bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border border-rose-800/50',
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs gap-1.5',
      md: 'h-9 px-4 text-sm gap-2',
      lg: 'h-11 px-5 text-base gap-2.5',
      icon: 'h-9 w-9 p-0',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent mr-1.5" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
