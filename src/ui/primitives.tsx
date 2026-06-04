import * as Select from "@radix-ui/react-select";
import * as Popover from "@radix-ui/react-popover";
import { type ButtonHTMLAttributes, type ReactNode, useId } from "react";

type ButtonVariant = "primary" | "ghost" | "danger";
type ButtonSize = "default" | "small" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const joinClassNames = (...classNames: Array<string | false | null | undefined>): string =>
  classNames.filter(Boolean).join(" ");

export function Button({
  variant = "ghost",
  size = "default",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const legacyClassName = variant === "primary"
    ? "primary-button"
    : variant === "danger"
      ? "ghost-button danger"
      : "ghost-button";

  return (
    <button
      className={joinClassNames("ui-button", `ui-button-${variant}`, `ui-button-${size}`, legacyClassName, className)}
      type={type}
      {...props}
    />
  );
}

type SelectOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
};

type SelectFieldProps<TValue extends string> = {
  label: string;
  value: TValue;
  options: Array<SelectOption<TValue>>;
  onChange: (value: TValue) => void;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  placeholderLabel?: boolean;
  placeholderValue?: TValue;
};

export function SelectField<TValue extends string>({
  label,
  value,
  options,
  onChange,
  className,
  compact = false,
  disabled = false,
  placeholderLabel = false,
  placeholderValue,
}: SelectFieldProps<TValue>) {
  const labelId = useId();
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = typeof selectedOption?.label === "string" ? selectedOption.label : value;
  const showPlaceholderLabel = placeholderLabel && placeholderValue !== undefined && value === placeholderValue;
  const displayLabel = showPlaceholderLabel ? label : selectedOption?.label;

  return (
    <div className={joinClassNames("select-field", compact && "select-field-compact", placeholderLabel && "select-field-placeholder", className)}>
      {placeholderLabel ? null : <span className="select-field-label" id={labelId}>{label}</span>}
      <Select.Root value={value} onValueChange={(nextValue) => onChange(nextValue as TValue)} disabled={disabled}>
        <Select.Trigger
          className={joinClassNames("select-trigger", showPlaceholderLabel && "select-trigger-placeholder")}
          aria-label={placeholderLabel ? `${label}: ${selectedLabel}` : undefined}
          aria-labelledby={placeholderLabel ? undefined : labelId}
        >
          <Select.Value>{displayLabel}</Select.Value>
          <Select.Icon className="select-trigger-icon">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={4}>
            <Select.Viewport className="select-viewport">
              {options.map((option) => (
                <Select.Item className="select-item" value={option.value} key={option.value}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-item-indicator">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

export function StatusBadge({ tone }: { tone: "green" | "red" | "blue" | "purple" }) {
  return <span className={`status-dot badge ${tone}`} aria-hidden="true" />;
}

export const UiPopover = Popover;
