declare module "google-spreadsheet" {
  import { Auth } from "google-auth-library";
  export class GoogleSpreadsheet {
    constructor(spreadsheetId: string, auth?: Auth);
    loadInfo(): Promise<void>;
    sheetsByTitle: Record<string, GoogleSpreadsheetWorksheet>;
    title: string;
  }
  export class GoogleSpreadsheetWorksheet {
    title: string;
    headerValues: string[];
    getRows(options?: { offset?: number; limit?: number }): Promise<any[]>;
    addRow(values: Record<string, string | number>): Promise<any>;
    addRows(rows: Record<string, string | number>[]): Promise<any>;
    loadHeaderRow(): Promise<void>;
    clearRows(): Promise<void>;
  }
}
