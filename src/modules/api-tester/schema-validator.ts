import * as fs from 'fs';
import { Logger } from '../../utils/logger';

interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, any> };
  definitions?: Record<string, any>;
}

interface OpenApiOperation {
  operationId?: string;
  parameters?: any[];
  requestBody?: any;
  responses: Record<string, { schema?: any; content?: any; description?: string }>;
}

export class SchemaValidator {
  private logger = new Logger('SchemaValidator');
  private spec: OpenApiSpec | null = null;

  async loadSpec(specPath: string): Promise<void> {
    try {
      const content = fs.readFileSync(specPath, 'utf-8');
      this.spec = JSON.parse(content);
      this.logger.log('OpenAPI spec loaded', { specPath });
    } catch (err) {
      this.logger.error('Failed to load OpenAPI spec', err);
      throw new Error(`Cannot load spec from ${specPath}: ${err}`);
    }
  }

  validateResponse(endpoint: string, method: string, statusCode: number, response: any): SchemaValidationResult {
    if (!this.spec) {
      return { valid: false, errors: ['OpenAPI spec not loaded'] };
    }

    const errors: string[] = [];
    const pathSpec = this.findPathSpec(endpoint);

    if (!pathSpec) {
      return { valid: false, errors: [`Path ${endpoint} not found in spec`] };
    }

    const operationSpec = pathSpec[method.toLowerCase()];
    if (!operationSpec) {
      return { valid: false, errors: [`Method ${method} not defined for ${endpoint}`] };
    }

    const responseSpec = operationSpec.responses[String(statusCode)] || operationSpec.responses['default'];
    if (!responseSpec) {
      errors.push(`Status code ${statusCode} not defined in spec for ${method} ${endpoint}`);
      return { valid: errors.length === 0, errors };
    }

    const schema = this.extractResponseSchema(responseSpec);
    if (schema && response !== undefined) {
      const schemaErrors = this.validateAgainstSchema(response, schema, '');
      errors.push(...schemaErrors);
    }

    return { valid: errors.length === 0, errors };
  }

  private findPathSpec(endpoint: string): Record<string, OpenApiOperation> | null {
    if (!this.spec) return null;

    // Exact match
    if (this.spec.paths[endpoint]) {
      return this.spec.paths[endpoint];
    }

    // Try matching with path parameters
    for (const [pattern, spec] of Object.entries(this.spec.paths)) {
      const regex = new RegExp('^' + pattern.replace(/\{[^}]+\}/g, '[^/]+') + '$');
      if (regex.test(endpoint)) {
        return spec;
      }
    }

    return null;
  }

  private extractResponseSchema(responseSpec: any): any {
    // OpenAPI 3.x
    if (responseSpec.content?.['application/json']?.schema) {
      return responseSpec.content['application/json'].schema;
    }
    // Swagger 2.x
    if (responseSpec.schema) {
      return responseSpec.schema;
    }
    return null;
  }

  private validateAgainstSchema(data: any, schema: any, path: string): string[] {
    const errors: string[] = [];

    // Resolve $ref
    if (schema.$ref) {
      const resolved = this.resolveRef(schema.$ref);
      if (!resolved) {
        errors.push(`${path}: Cannot resolve reference ${schema.$ref}`);
        return errors;
      }
      return this.validateAgainstSchema(data, resolved, path);
    }

    if (schema.type === 'object' || schema.properties) {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        errors.push(`${path || 'root'}: Expected object, got ${typeof data}`);
        return errors;
      }

      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in data)) {
            errors.push(`${path}.${field}: Required field missing`);
          }
        }
      }

      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in data) {
            errors.push(...this.validateAgainstSchema(data[key], propSchema, `${path}.${key}`));
          }
        }
      }
    }

    if (schema.type === 'array') {
      if (!Array.isArray(data)) {
        errors.push(`${path || 'root'}: Expected array, got ${typeof data}`);
      } else if (schema.items && data.length > 0) {
        errors.push(...this.validateAgainstSchema(data[0], schema.items, `${path}[0]`));
      }
    }

    if (schema.type === 'string' && typeof data !== 'string') {
      errors.push(`${path || 'root'}: Expected string, got ${typeof data}`);
    }
    if (schema.type === 'number' && typeof data !== 'number') {
      errors.push(`${path || 'root'}: Expected number, got ${typeof data}`);
    }
    if (schema.type === 'integer' && !Number.isInteger(data)) {
      errors.push(`${path || 'root'}: Expected integer, got ${typeof data}`);
    }
    if (schema.type === 'boolean' && typeof data !== 'boolean') {
      errors.push(`${path || 'root'}: Expected boolean, got ${typeof data}`);
    }

    if (schema.enum && !schema.enum.includes(data)) {
      errors.push(`${path || 'root'}: Value ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
    }

    return errors;
  }

  private resolveRef(ref: string): any {
    if (!this.spec) return null;
    const parts = ref.replace('#/', '').split('/');

    let current: any = this.spec;
    for (const part of parts) {
      current = current?.[part];
      if (!current) return null;
    }
    return current;
  }
}
