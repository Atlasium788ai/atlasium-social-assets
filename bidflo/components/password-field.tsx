"use client";

import { useState, type InputHTMLAttributes } from "react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

export function PasswordField({ label, className = "", ...inputProps }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <label className={`visez-login-field ${className}`.trim()}>
      <span>{label}</span>
      <div className="password-input-wrap">
        <input {...inputProps} type={visible ? "text" : "password"} />
        <button
          type="button"
          className="password-visibility-toggle"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.4A11 11 0 0 1 12 4c5.3 0 9 5 9 8a9.8 9.8 0 0 1-2.1 3.8M6.2 6.2C4.1 7.6 3 10 3 12c0 3 3.7 8 9 8a10 10 0 0 0 3.3-.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12c0-3 3.7-8 9-8s9 5 9 8-3.7 8-9 8-9-5-9-8Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}
