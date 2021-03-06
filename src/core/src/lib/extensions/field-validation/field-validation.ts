import { FormlyConfig } from '../../services/formly.config';
import { FormlyExtension, ValidatorOption, FormlyFieldConfigCache } from '../../models';
import { AbstractControl, Validators, ValidatorFn } from '@angular/forms';
import { FORMLY_VALIDATORS, defineHiddenProp, isPromise, observe, clone } from '../../utils';
import { updateValidity } from '../field-form/utils';
import { isObservable } from 'rxjs';
import { map } from 'rxjs/operators';

/** @experimental */
export class FieldValidationExtension implements FormlyExtension {
  constructor(private config: FormlyConfig) {}

  onPopulate(field: FormlyFieldConfigCache) {
    this.initFieldValidation(field, 'validators');
    this.initFieldValidation(field, 'asyncValidators');
  }

  private initFieldValidation(field: FormlyFieldConfigCache, type: 'validators' | 'asyncValidators') {
    const validators: ValidatorFn[] = [];
    if (type === 'validators' && !(field.hasOwnProperty('fieldGroup') && !field.key)) {
      validators.push(this.getPredefinedFieldValidation(field));
    }

    if (field[type]) {
      for (const validatorName of Object.keys(field[type])) {
        validatorName === 'validation'
          ? validators.push(...field[type].validation.map((v) => this.wrapNgValidatorFn(field, v)))
          : validators.push(this.wrapNgValidatorFn(field, field[type][validatorName], validatorName));
      }
    }

    defineHiddenProp(field, '_' + type, validators);
  }

  private getPredefinedFieldValidation(field: FormlyFieldConfigCache): ValidatorFn {
    let VALIDATORS = [];
    FORMLY_VALIDATORS.forEach((opt) =>
      observe(field, ['templateOptions', opt], ({ currentValue, firstChange }) => {
        VALIDATORS = VALIDATORS.filter((o) => o !== opt);
        if (currentValue != null && currentValue !== false) {
          VALIDATORS.push(opt);
        }
        if (!firstChange && field.formControl) {
          updateValidity(field.formControl);
        }
      }),
    );

    return (control: AbstractControl) => {
      if (VALIDATORS.length === 0) {
        return null;
      }

      return Validators.compose(
        VALIDATORS.map((opt) => () => {
          const value = field.templateOptions[opt];
          switch (opt) {
            case 'required':
              return Validators.required(control);
            case 'pattern':
              return Validators.pattern(value)(control);
            case 'minLength':
              return Validators.minLength(value)(control);
            case 'maxLength':
              return Validators.maxLength(value)(control);
            case 'min':
              return Validators.min(value)(control);
            case 'max':
              return Validators.max(value)(control);
          }
        }),
      )(control);
    };
  }

  private wrapNgValidatorFn(field: FormlyFieldConfigCache, validator: any, validatorName?: string) {
    let validatorOption: ValidatorOption = null;
    if (typeof validator === 'string') {
      validatorOption = clone(this.config.getValidator(validator));
    }

    if (typeof validator === 'object' && validator.name) {
      validatorOption = clone(this.config.getValidator(validator.name));
      if (validator.options) {
        validatorOption.options = validator.options;
      }
    }

    if (typeof validator === 'object' && validator.expression) {
      const { expression, ...options } = validator;
      validatorOption = {
        name: validatorName,
        validation: expression,
        options: Object.keys(options).length > 0 ? options : null,
      };
    }

    if (typeof validator === 'function') {
      validatorOption = {
        name: validatorName,
        validation: validator,
      };
    }

    return (control: AbstractControl) => {
      let errors: any = validatorOption.validation(control, field, validatorOption.options);
      if (validatorName) {
        if (isPromise(errors)) {
          return errors.then((v) => this.handleAsyncResult(field, v, validatorOption));
        }

        if (isObservable(errors)) {
          return errors.pipe(map((v) => this.handleAsyncResult(field, v, validatorOption)));
        }

        errors = !!errors;
      }

      return this.handleResult(field, errors, validatorOption);
    };
  }

  private handleAsyncResult(field: FormlyFieldConfigCache, isValid, options: ValidatorOption) {
    // workaround for https://github.com/angular/angular/issues/13200
    if (field.options && field.options._markForCheck) {
      field.options._markForCheck(field);
    }

    return this.handleResult(field, !!isValid, options);
  }

  private handleResult(field: FormlyFieldConfigCache, errors: any, { name, options }: ValidatorOption) {
    if (typeof errors === 'boolean') {
      errors = errors ? null : { [name]: options ? options : true };
    }

    if (options && field.formControl && options.errorPath) {
      const control = field.formControl.get(options.errorPath);
      if (control) {
        const controlErrors = control.errors || {};
        if (errors && errors[name] && !controlErrors[name]) {
          const { errorPath, ...opts } = errors[name];
          control.setErrors({ ...controlErrors, [name]: opts });
        } else if (errors === null && controlErrors[name]) {
          delete controlErrors[name];
          control.setErrors(Object.keys(controlErrors).length === 0 ? null : controlErrors);
        }
      }
    }

    return errors;
  }
}
