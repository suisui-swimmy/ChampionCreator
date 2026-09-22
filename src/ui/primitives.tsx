import * as Select from "@radix-ui/react-select";
import * as Popover from "@radix-ui/react-popover";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import { type ButtonHTMLAttributes, type ReactNode, useId } from "react";
import { getPublicAssetUrl } from "./publicAssetUrl";

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

export function SearchProgress({
  progress,
  searchedCandidates,
  totalCandidates,
  label = "探索進捗",
  canCancel = false,
  onCancel,
}: {
  progress: number;
  searchedCandidates: number;
  totalCandidates: number;
  label?: string;
  canCancel?: boolean;
  onCancel?: () => void;
}) {
  const percent = Math.round(progress * 100);
  return (
    <div className="search-progress-row">
      <div className="search-progress" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span className="search-progress-fill" style={{ width: `${percent}%` }} aria-hidden="true" />
        <span className="search-progress-label" aria-live="polite">
          <strong>{percent}%</strong>
          <span>評価 {searchedCandidates} / {totalCandidates || "-"}</span>
        </span>
      </div>
      <Button size="icon" className="progress-cancel-button" aria-label="計算を中止"
        disabled={!canCancel} onClick={onCancel}>
        <img src={getPublicAssetUrl("assets/ui/circle-x.svg")} alt="" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Reserve both labels' width and height while only the visible text changes. */
export function StableButtonLabel({ idle, busy, running }: { idle: string; busy: string; running: boolean }) {
  return <span className="stable-button-label">
    <span className="stable-button-label-reserve" aria-hidden="true">{idle}</span>
    <span className="stable-button-label-reserve" aria-hidden="true">{busy}</span>
    <span>{running ? busy : idle}</span>
  </span>;
}

type StepperAction = {
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
};

type StepperControlProps = {
  ariaLabel: string;
  lowerAction: StepperAction;
  upperAction: StepperAction;
  children: ReactNode;
  className?: string;
};

export function StepperControl({
  ariaLabel,
  lowerAction,
  upperAction,
  children,
  className,
}: StepperControlProps) {
  return (
    <span className={joinClassNames("ui-stepper", className)} role="group" aria-label={ariaLabel}>
      <button
        className="ui-stepper-button ui-stepper-button--lower"
        type="button"
        aria-label={lowerAction.ariaLabel}
        disabled={lowerAction.disabled}
        onClick={lowerAction.onClick}
      >
        ▼
      </button>
      <span className="ui-stepper-value">{children}</span>
      <button
        className="ui-stepper-button ui-stepper-button--upper"
        type="button"
        aria-label={upperAction.ariaLabel}
        disabled={upperAction.disabled}
        onClick={upperAction.onClick}
      >
        ▲
      </button>
    </span>
  );
}

type SelectOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
};

type SelectFieldProps<TValue extends string> = {
  label: string;
  ariaLabel?: string;
  value: TValue;
  options: Array<SelectOption<TValue>>;
  onChange: (value: TValue) => void;
  className?: string;
  contentClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  placeholderLabel?: boolean;
  placeholderValue?: TValue;
  valueBadge?: ReactNode;
};

export function SelectField<TValue extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  className,
  contentClassName,
  compact = false,
  disabled = false,
  placeholderLabel = false,
  placeholderValue,
  valueBadge,
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
          className={joinClassNames(
            "select-trigger",
            showPlaceholderLabel && "select-trigger-placeholder",
            Boolean(valueBadge) && "select-trigger-has-badge",
          )}
          aria-label={ariaLabel ?? (placeholderLabel ? `${label}: ${selectedLabel}` : undefined)}
          aria-labelledby={ariaLabel || placeholderLabel ? undefined : labelId}
        >
          <Select.Value>{displayLabel}</Select.Value>
          {valueBadge ? <span className="select-trigger-value-badge" aria-hidden="true">{valueBadge}</span> : null}
          <Select.Icon className="select-trigger-icon">
            <ChevronRightIcon className="disclosure-chevron" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className={joinClassNames("select-content", contentClassName)} position="popper" sideOffset={4}>
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
