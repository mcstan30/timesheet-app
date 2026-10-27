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
    moveDown: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    addPage: jest.fn().mockReturnThis(),
    pipe: jest.fn(function (destination) {
      this.destination = destination;
      return destination;
    }),
    end: jest.fn(function () {
      if (this.destination) {
        this.destination.end();
      }
    }),
    y: 100
  }));
});

const reportRoutes = require('../../routes/reports');
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

  describe('PDF Export - successful generation', () => {
    const PDFDocument = require('pdfkit');
    const getPdfDoc = () => PDFDocument.mock.results[0].value;
    const getWrittenText = () => getPdfDoc().text.mock.calls.map((call) => call[0]);

    const mockReport = (client, workEntries) => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, client);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, workEntries);
      });
    };

    test('should write correct totals and every entry for a report with several entries', async () => {
      mockReport({ id: 1, name: 'Test Client' }, [
        { date: '2024-01-04', hours: 1.5, description: 'Work 1', created_at: '2024-01-04' },
        { date: '2024-01-03', hours: 2.25, description: 'Work 2', created_at: '2024-01-03' },
        { date: '2024-01-02', hours: 3, description: 'Work 3', created_at: '2024-01-02' },
        { date: '2024-01-01', hours: '7.25', description: 'Work 4', created_at: '2024-01-01' }
      ]);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');

      const text = getWrittenText();
      expect(text).toContain('Time Report for Test Client');
      expect(text).toContain('Total Hours: 14.00');
      expect(text).toContain('Total Entries: 4');

      const writtenDates = text.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
      expect(writtenDates).toEqual(['2024-01-04', '2024-01-03', '2024-01-02', '2024-01-01']);
      expect(text).toEqual(expect.arrayContaining(['1.5', '2.25', '3', '7.25']));
      expect(text).toEqual(expect.arrayContaining(['Work 1', 'Work 2', 'Work 3', 'Work 4']));
      expect(getPdfDoc().end).toHaveBeenCalledTimes(1);
    });

    test('should generate a report with 0.00 total hours when there are no entries', async () => {
      mockReport({ id: 1, name: 'Empty Client' }, []);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');

      const text = getWrittenText();
      expect(text).toContain('Total Hours: 0.00');
      expect(text).toContain('Total Entries: 0');
      expect(text).not.toContain('No description');
      expect(text.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))).toEqual([]);
      expect(getPdfDoc().addPage).not.toHaveBeenCalled();
      expect(getPdfDoc().end).toHaveBeenCalledTimes(1);
    });

    test('should show "No description" for an entry without a description', async () => {
      mockReport({ id: 1, name: 'Test Client' }, [
        { date: '2024-01-02', hours: 2, description: 'Described work', created_at: '2024-01-02' },
        { date: '2024-01-01', hours: 1, description: null, created_at: '2024-01-01' }
      ]);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      const text = getWrittenText();
      expect(text).toContain('Described work');
      expect(text.filter((value) => value === 'No description')).toHaveLength(1);
    });

    test('should add a new page when entries reach the bottom of the page', async () => {
      const defaultImplementation = PDFDocument.getMockImplementation();
      PDFDocument.mockImplementationOnce(() => ({ ...defaultImplementation(), y: 750 }));

      const workEntries = Array.from({ length: 3 }, (_, index) => ({
        date: `2024-01-0${index + 1}`,
        hours: 1,
        description: `Work ${index + 1}`,
        created_at: `2024-01-0${index + 1}`
      }));
      mockReport({ id: 1, name: 'Test Client' }, workEntries);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(getPdfDoc().addPage).toHaveBeenCalledTimes(workEntries.length);
      expect(getWrittenText()).toContain('Total Entries: 3');
    });

    test('should make the client name safe in the download filename', async () => {
      mockReport({ id: 1, name: 'Acme & Sons, Inc./Ltd' }, []);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="Acme___Sons__Inc__Ltd_report_[A-Za-z0-9_-]+\.pdf"$/
      );
      expect(getWrittenText()).toContain('Time Report for Acme & Sons, Inc./Ltd');
    });

    test('should return 404 and generate nothing for a client owned by another user', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        const ownedByRequester = params[0] === 1 && params[1] === 'other@example.com';
        callback(null, ownedByRequester ? { id: 1, name: 'Other User Client' } : undefined);
      });

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('user_email = ?'),
        [1, 'test@example.com'],
        expect.any(Function)
      );
      expect(mockDb.all).not.toHaveBeenCalled();
      expect(PDFDocument).not.toHaveBeenCalled();
    });
  });

  describe('CSV Export - successful download', () => {
    const csvWriter = require('csv-writer');
    const mockClient = { id: 1, name: 'Acme & Sons, Inc./Ltd' };
    const mockWorkEntries = [
      { date: '2024-01-02', hours: 1.5, description: 'Work 1', created_at: '2024-01-02' },
      { date: '2024-01-01', hours: '7.25', description: null, created_at: '2024-01-01' }
    ];
    let writeRecords;
    let downloadSpy;
    let consoleErrorSpy;
    let downloadError;

    beforeEach(() => {
      writeRecords = jest.fn().mockResolvedValue(undefined);
      csvWriter.createObjectCsvWriter.mockReturnValue({ writeRecords });

      downloadError = null;
      downloadSpy = jest.spyOn(app.response, 'download').mockImplementation(function (filePath, filename, callback) {
        this.attachment(filename);
        this.status(200).send('csv-content');
        callback(downloadError);
      });
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, mockClient);
      });

      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });
    });

    afterEach(() => {
      downloadSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    test('should write entries to a temp CSV, download it with a safe filename and delete it', async () => {
      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="Acme___Sons__Inc__Ltd_report_[A-Za-z0-9_-]+\.csv"$/
      );

      expect(csvWriter.createObjectCsvWriter).toHaveBeenCalledWith({
        path: expect.stringMatching(/temp[\\/]Acme___Sons__Inc__Ltd_report_[A-Za-z0-9_-]+\.csv$/),
        header: [
          { id: 'date', title: 'Date' },
          { id: 'hours', title: 'Hours' },
          { id: 'description', title: 'Description' },
          { id: 'created_at', title: 'Created At' }
        ]
      });
      expect(writeRecords).toHaveBeenCalledWith(mockWorkEntries);

      const tempPath = csvWriter.createObjectCsvWriter.mock.calls[0][0].path;
      const filename = tempPath.split(/[\\/]/).pop();
      expect(downloadSpy).toHaveBeenCalledWith(tempPath, filename, expect.any(Function));
      expect(fs.unlink).toHaveBeenCalledWith(tempPath, expect.any(Function));
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test('should log and still delete the temp file when sending the file fails', async () => {
      downloadError = new Error('Download failed');

      await request(app).get('/api/reports/export/csv/1');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error sending file:', downloadError);
      expect(fs.unlink).toHaveBeenCalledTimes(1);
    });

    test('should log when the temp file cannot be deleted', async () => {
      const unlinkError = new Error('Unlink failed');
      fs.unlink = jest.fn((filePath, callback) => callback(unlinkError));

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error deleting temp file:', unlinkError);
    });

    test('should return 404 and write no CSV for a client owned by another user', async () => {
      mockDb.get.mockImplementation((query, params, callback) => {
        const ownedByRequester = params[0] === 1 && params[1] === 'other@example.com';
        callback(null, ownedByRequester ? mockClient : undefined);
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
      expect(mockDb.all).not.toHaveBeenCalled();
      expect(csvWriter.createObjectCsvWriter).not.toHaveBeenCalled();
      expect(downloadSpy).not.toHaveBeenCalled();
    });
  });
});
