import type { ReactNode } from "react";

import type {
  ConfigFieldSchema,
  ConfigSchema,
  NumberFieldSchema,
  BooleanFieldSchema,
  EnumFieldSchema,
} from "@openturn/core";

export interface ConfigFieldRendererProps<TValue, TSchema extends ConfigFieldSchema> {
  value: TValue;
  defaultValue: TValue;
  schema: TSchema;
  disabled: boolean;
  error?: string;
  onChange: (next: TValue) => void;
}

export type ConfigFieldRenderer<TValue, TSchema extends ConfigFieldSchema> = (
  props: ConfigFieldRendererProps<TValue, TSchema>,
) => ReactNode;

export type ConfigRenderers<TSchema extends ConfigSchema> = {
  [K in keyof TSchema]?:
    TSchema[K] extends NumberFieldSchema ? ConfigFieldRenderer<number, NumberFieldSchema> :
    TSchema[K] extends BooleanFieldSchema ? ConfigFieldRenderer<boolean, BooleanFieldSchema> :
    TSchema[K] extends EnumFieldSchema<infer TOption> ? ConfigFieldRenderer<TOption, EnumFieldSchema<TOption>> :
    never;
};

export interface ConfigFormProps {
  schema: ConfigSchema;
  values: Readonly<Record<string, unknown>>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
  errors?: Readonly<Record<string, string>>;
  renderers?: Record<string, ConfigFieldRenderer<any, any>>;
}

export function ConfigForm(props: ConfigFormProps): ReactNode {
  const { schema, values, disabled, onChange, errors, renderers } = props;
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(schema).map(([key, field]) => {
        const value = values[key] ?? field.default;
        const error = errors?.[key];
        const customRenderer = renderers?.[key];
        const rendererProps: ConfigFieldRendererProps<any, any> = {
          value,
          defaultValue: field.default,
          schema: field,
          disabled,
          onChange: (next: unknown) => onChange(key, next),
          ...(error !== undefined ? { error } : {}),
        };
        const fieldNode = customRenderer !== undefined
          ? customRenderer(rendererProps)
          : renderDefault(key, field, value, disabled, error, (next: unknown) => onChange(key, next));
        return (
          <div key={key} className="flex flex-col gap-1">
            {fieldNode}
            {field.description !== undefined ? (
              <p className="text-xs text-gray-500">{field.description}</p>
            ) : null}
            {error !== undefined ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function renderDefault(
  key: string,
  field: ConfigFieldSchema,
  value: unknown,
  disabled: boolean,
  error: string | undefined,
  onChange: (next: unknown) => void,
): ReactNode {
  if (field.type === "number") {
    return <NumberInput fieldKey={key} field={field} value={value as number} disabled={disabled} onChange={onChange} />;
  }
  if (field.type === "boolean") {
    return <BooleanToggle fieldKey={key} field={field} value={value as boolean} disabled={disabled} onChange={onChange} />;
  }
  if (field.type === "enum") {
    return <EnumPicker fieldKey={key} field={field} value={value as string} disabled={disabled} onChange={onChange} />;
  }
  return null;
}

function NumberInput(props: {
  fieldKey: string;
  field: NumberFieldSchema;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}): ReactNode {
  const { fieldKey, field, value, disabled, onChange } = props;
  const inputType =
    field.min !== undefined && field.max !== undefined ? "range" : "number";
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={fieldKey}>
      <span>{field.label}</span>
      <input
        id={fieldKey}
        type={inputType}
        value={value}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

function BooleanToggle(props: {
  fieldKey: string;
  field: BooleanFieldSchema;
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  const { fieldKey, field, value, disabled, onChange } = props;
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={fieldKey}>
      <input
        id={fieldKey}
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{field.label}</span>
    </label>
  );
}

function EnumPicker(props: {
  fieldKey: string;
  field: EnumFieldSchema;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}): ReactNode {
  const { fieldKey, field, value, disabled, onChange } = props;
  const useRadio = field.options.length <= 4;
  const labelFor = (option: string) => field.labels?.[option] ?? option;

  if (useRadio) {
    return (
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend>{field.label}</legend>
        {field.options.map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="radio"
              name={fieldKey}
              value={option}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            <span>{labelFor(option)}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={fieldKey}>
      <span>{field.label}</span>
      <select
        id={fieldKey}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.options.map((option) => (
          <option key={option} value={option}>
            {labelFor(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
