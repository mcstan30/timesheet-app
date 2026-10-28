const request = require('supertest');
const express = require('express');
const { getDatabase } = require('../../database/init');
const fs = require('fs');
const path = require('path');

jest.mock('../../database/init');
jest.mock('fs');
jest.mock('csv-writer', () => ({
  createObjectCsvWriter: jest.fn(() => ({
    writeRecords: jest.fn().mockResolvedValue(undefined)
  }))
}));
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => ({
    fontSize: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveDown: jest.fn(function () {
      this.y += 30;
      return this;
    }),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    addPage: jest.fn(function () {
      this.y = 72;
      return this;
    }),
    pipe: jest.fn(function (destination) {
      this.destination = destination;
      return destination;
    }),
    end: jest.fn(function () {
      this.destination.end();
    }),
    y: 100
  }));
});

const reportRoutes = require('../../routes/reports');
const PDFDocument = require('pdfkit');
const csvWriter = require('csv-writer');
jest.mock('../../middleware/auth', () => ({
  authenticateUser: (req, res, next) => {
    req.userEmail = 'test@example.com';
    next();
  }
}));

const app = express();
app.use(express.json());
app.use('/api/reports', reportRoutes);

describe('Report Routes', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = {
      all: jest.fn(),
      get: jest.fn()
    };
    getDatabase.mockReturnValue(mockDb);
    
    // Mock fs methods
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.mkdirSync = jest.fn();
    fs.unlink = jest.fn((path, callback) => callback(null));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/reports/client/:clientId', () => {
    test('should return client report with work entries', async () => {
      const mockClient = { id: 1, name: 'Test Client' };
      const mockWorkEntries = [
        { id: 1, hours: 5.5, description: 'Work 1', date: '2024-01-01' },
        { id: 2, hours: 3.0, description: 'Work 2', date: '2024-01-02' }
      ];

      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, mockClient);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(200);
      expect(response.body.client).toEqual(mockClient);
      expect(response.body.workEntries).toEqual(mockWorkEntries);
      expect(response.body.totalHours).toBe(8.5);
      expect(response.body.entryCount).toBe(2);
    });

    test('should return report with zero hours for client with no entries', async () => {
      const mockClient = { id: 1, name: 'Empty Client' };

      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, mockClient);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(200);
      expect(response.body.totalHours).toBe(0);
      expect(response.body.entryCount).toBe(0);
    });

    test('should return 404 if client not found', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const response = await request(app).get('/api/reports/client/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
    });

    test('should return 400 for invalid client ID', async () => {
      const response = await request(app).get('/api/reports/client/invalid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid client ID' });
    });

    test('should handle database error when fetching client', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should handle database error when fetching work entries', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should filter work entries by user email', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        expect(params).toEqual([1, 'test@example.com']);
        callback(null, []);
      });

      await request(app).get('/api/reports/client/1');

      expect(mockDb.all).toHaveBeenCalledWith(
        expect.stringContaining('WHERE client_id = ? AND user_email = ?'),
        [1, 'test@example.com'],
        expect.any(Function)
      );
    });
  });

  describe('GET /api/reports/export/csv/:clientId', () => {
    test('should return 400 for invalid client ID', async () => {
      const response = await request(app).get('/api/reports/export/csv/invalid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid client ID' });
    });

    test('should return 404 if client not found', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const response = await request(app).get('/api/reports/export/csv/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
    });

    test('should handle database error when fetching client', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should handle database error when fetching work entries', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('GET /api/reports/export/pdf/:clientId', () => {
    test('should return 400 for invalid client ID', async () => {
      const response = await request(app).get('/api/reports/export/pdf/invalid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid client ID' });
    });

    test('should return 404 if client not found', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const response = await request(app).get('/api/reports/export/pdf/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
    });

    test('should handle database error', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('Data Isolation', () => {
    test('should only return data for authenticated user', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        expect(params).toContain('test@example.com');
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        expect(params).toContain('test@example.com');
        callback(null, []);
      });

      await request(app).get('/api/reports/client/1');

      expect(mockDb.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['test@example.com']),
        expect.any(Function)
      );
    });
  });

  describe('Hours Calculation', () => {
    test('should correctly sum decimal hours', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, [
          { hours: 2.5 },
          { hours: 3.75 },
          { hours: 1.25 }
        ]);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.body.totalHours).toBe(7.5);
    });

    test('should handle integer hours', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, [
          { hours: 8 },
          { hours: 4 }
        ]);
      });

      const response = await request(app).get('/api/reports/client/1');

      expect(response.body.totalHours).toBe(12);
    });
  });

  describe('CSV Export Success Path', () => {
    test('should handle CSV write error', async () => {
      const mockClient = { id: 1, name: 'Test Client' };
      const mockWorkEntries = [
        { date: '2024-01-01', hours: 5, description: 'Work 1', created_at: '2024-01-01' }
      ];

      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, mockClient);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });

      const csvWriter = require('csv-writer');
      csvWriter.createObjectCsvWriter.mockReturnValue({
        writeRecords: jest.fn().mockRejectedValue(new Error('Write failed'))
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to generate CSV report' });
    });

    test('should verify CSV export calls correct database queries', async () => {
      const mockClient = { id: 1, name: 'Test Client' };

      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, mockClient);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      const csvWriter = require('csv-writer');
      csvWriter.createObjectCsvWriter.mockReturnValue({
        writeRecords: jest.fn().mockRejectedValue(new Error('Write failed'))
      });

      await request(app).get('/api/reports/export/csv/1');

      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, name FROM clients'),
        expect.arrayContaining([1, 'test@example.com']),
        expect.any(Function)
      );
    });

    test('should create temp directory if it does not exist', async () => {
      const mockClient = { id: 1, name: 'Test Client' };
      const mockWorkEntries = [
        { date: '2024-01-01', hours: 5, description: 'Work 1', created_at: '2024-01-01' }
      ];

      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, mockClient);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });

      fs.existsSync.mockReturnValue(false);

      const csvWriter = require('csv-writer');
      csvWriter.createObjectCsvWriter.mockReturnValue({
        writeRecords: jest.fn().mockRejectedValue(new Error('Write failed'))
      });

      await request(app).get('/api/reports/export/csv/1');

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    test('should not create temp directory if it exists', async () => {
      const mockClient = { id: 1, name: 'Test Client' };
      const mockWorkEntries = [];

      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, mockClient);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });

      fs.existsSync.mockReturnValue(true);

      const csvWriter = require('csv-writer');
      csvWriter.createObjectCsvWriter.mockReturnValue({
        writeRecords: jest.fn().mockRejectedValue(new Error('Write failed'))
      });

      await request(app).get('/api/reports/export/csv/1');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });


  describe('PDF Export Success Path', () => {
    test('should handle database error when fetching work entries for PDF', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    test('should verify PDF export calls correct database queries', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Test Client' });
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await request(app).get('/api/reports/export/pdf/1');

      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, name FROM clients'),
        expect.arrayContaining([1, 'test@example.com']),
        expect.any(Function)
      );
    });
  });

  describe('PDF Export - Report Content', () => {
    const mockClient = { id: 1, name: 'Test Client' };

    const mockReportData = (client, workEntries) => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, client);
      });
      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, workEntries);
      });
    };

    const getPdfDoc = () => PDFDocument.mock.results[0].value;

    const expectEntryRow = (doc, entry, description = entry.description) => {
      expect(doc.text).toHaveBeenCalledWith(entry.date, 50, expect.any(Number), { width: 100 });
      expect(doc.text).toHaveBeenCalledWith(entry.hours.toString(), 150, expect.any(Number), { width: 80 });
      expect(doc.text).toHaveBeenCalledWith(description, 230, expect.any(Number), { width: 300 });
    };

    test('should write correct totals and every entry for a report with decimal hours', async () => {
      const mockWorkEntries = [
        { date: '2024-01-04', hours: 1.5, description: 'Workshop', created_at: '2024-01-04' },
        { date: '2024-01-03', hours: 2.25, description: 'Analysis', created_at: '2024-01-03' },
        { date: '2024-01-02', hours: 0.75, description: 'Call', created_at: '2024-01-02' },
        { date: '2024-01-01', hours: '7.25', description: 'Report writing', created_at: '2024-01-01' }
      ];
      mockReportData(mockClient, mockWorkEntries);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');

      const doc = getPdfDoc();
      expect(doc.pipe).toHaveBeenCalledTimes(1);
      expect(doc.end).toHaveBeenCalledTimes(1);
      expect(doc.text).toHaveBeenCalledWith('Time Report for Test Client', { align: 'center' });
      expect(doc.text).toHaveBeenCalledWith('Total Hours: 11.75');
      expect(doc.text).toHaveBeenCalledWith('Total Entries: 4');
      mockWorkEntries.forEach((entry) => expectEntryRow(doc, entry));
    });

    test('should show zero totals and no entry rows for a report with no entries', async () => {
      mockReportData({ id: 1, name: 'Empty Client' }, []);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');

      const doc = getPdfDoc();
      expect(doc.text).toHaveBeenCalledWith('Total Hours: 0.00');
      expect(doc.text).toHaveBeenCalledWith('Total Entries: 0');
      // Title, 3 summary lines and 3 table headers only
      expect(doc.text).toHaveBeenCalledTimes(7);
      expect(doc.addPage).not.toHaveBeenCalled();
      expect(doc.end).toHaveBeenCalledTimes(1);
    });

    test('should show "No description" for entries without a description', async () => {
      const mockWorkEntries = [
        { date: '2024-01-02', hours: 2, description: null, created_at: '2024-01-02' },
        { date: '2024-01-01', hours: 3, description: '', created_at: '2024-01-01' }
      ];
      mockReportData(mockClient, mockWorkEntries);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);

      const doc = getPdfDoc();
      mockWorkEntries.forEach((entry) => expectEntryRow(doc, entry, 'No description'));
      const noDescriptionCalls = doc.text.mock.calls.filter(([text]) => text === 'No description');
      expect(noDescriptionCalls).toHaveLength(2);
    });

    test('should add a new page and still write every entry for a long report', async () => {
      const mockWorkEntries = Array.from({ length: 25 }, (_, index) => ({
        date: `2024-02-${String(index + 1).padStart(2, '0')}`,
        hours: 1.5,
        description: `Task ${index + 1}`,
        created_at: '2024-02-01'
      }));
      mockReportData(mockClient, mockWorkEntries);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);

      const doc = getPdfDoc();
      expect(doc.addPage).toHaveBeenCalled();
      expect(doc.text).toHaveBeenCalledWith('Total Hours: 37.50');
      expect(doc.text).toHaveBeenCalledWith('Total Entries: 25');
      mockWorkEntries.forEach((entry) => expectEntryRow(doc, entry));
      // Header line plus a separator after every 5 entries
      expect(doc.moveTo).toHaveBeenCalledTimes(1 + 25 / 5);
    });

    test('should make the client name safe in the download filename', async () => {
      mockReportData({ id: 1, name: 'Acme & Co / "UK"' }, []);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="Acme___Co____UK__report_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.pdf"$/
      );
    });
  });

  describe('Report Export - Another User\'s Client', () => {
    test.each([
      ['PDF export', '/api/reports/export/pdf/1'],
      ['CSV export', '/api/reports/export/csv/1'],
      ['JSON report', '/api/reports/client/1']
    ])('%s should return 404 and leak no data', async (_label, url) => {
      const clientsTable = [{ id: 1, name: 'Owner Client', user_email: 'owner@example.com' }];
      mockDb.get.mockImplementation((query, [id, userEmail], callback) => {
        const row = clientsTable.find((c) => c.id === id && c.user_email === userEmail);
        callback(null, row && { id: row.id, name: row.name });
      });
      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, [{ date: '2024-01-01', hours: 8, description: 'Confidential work' }]);
      });

      const response = await request(app).get(url);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
      expect(mockDb.get).toHaveBeenCalledWith(expect.any(String), [1, 'test@example.com'], expect.any(Function));
      expect(mockDb.all).not.toHaveBeenCalled();
      expect(PDFDocument).not.toHaveBeenCalled();
      expect(csvWriter.createObjectCsvWriter).not.toHaveBeenCalled();
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(response.text).not.toContain('Owner Client');
    });
  });

  describe('CSV Export - Successful Download', () => {
    const mockWorkEntries = [
      { date: '2024-01-02', hours: 1.5, description: 'Workshop', created_at: '2024-01-02' },
      { date: '2024-01-01', hours: 7.25, description: null, created_at: '2024-01-01' }
    ];
    let writeRecords;
    let downloadSpy;
    let consoleErrorSpy;

    beforeEach(() => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Acme & Co / "UK"' });
      });
      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });

      writeRecords = jest.fn().mockResolvedValue(undefined);
      csvWriter.createObjectCsvWriter.mockReturnValue({ writeRecords });

      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      downloadSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    const mockDownload = (sendError) => {
      downloadSpy = jest.spyOn(app.response, 'download').mockImplementation(function (filePath, filename, callback) {
        this.status(200).end();
        callback(sendError);
      });
    };

    test('should write entries to a temp CSV, send it with a safe filename and delete it', async () => {
      mockDownload(null);

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      expect(csvWriter.createObjectCsvWriter).toHaveBeenCalledWith({
        path: expect.stringMatching(/temp[\\/]Acme___Co____UK__report_[\dTZ-]+\.csv$/),
        header: [
          { id: 'date', title: 'Date' },
          { id: 'hours', title: 'Hours' },
          { id: 'description', title: 'Description' },
          { id: 'created_at', title: 'Created At' }
        ]
      });
      expect(writeRecords).toHaveBeenCalledWith(mockWorkEntries);

      const tempPath = csvWriter.createObjectCsvWriter.mock.calls[0][0].path;
      expect(downloadSpy).toHaveBeenCalledWith(
        tempPath,
        expect.stringMatching(/^Acme___Co____UK__report_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.csv$/),
        expect.any(Function)
      );
      expect(fs.unlink).toHaveBeenCalledWith(tempPath, expect.any(Function));
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test('should log send and cleanup failures without crashing', async () => {
      const sendError = new Error('Send failed');
      const unlinkError = new Error('Unlink failed');
      fs.unlink = jest.fn((filePath, callback) => callback(unlinkError));
      mockDownload(sendError);

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      const tempPath = csvWriter.createObjectCsvWriter.mock.calls[0][0].path;
      expect(fs.unlink).toHaveBeenCalledWith(tempPath, expect.any(Function));
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error sending file:', sendError);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error deleting temp file:', unlinkError);
    });
  });
});
