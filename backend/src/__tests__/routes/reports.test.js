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
    pipe: jest.fn(),
    end: jest.fn(),
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

    // Records text written to the PDF, advances the cursor like pdfkit and
    // finishes the HTTP response on end() so supertest resolves.
    const createRecordingPdfDoc = () => ({
      y: 100,
      fontSize: jest.fn().mockReturnThis(),
      text: jest.fn(function (value, x, y) {
        if (typeof y === 'number') {
          this.y = y;
        }
        this.y += 15;
        return this;
      }),
      moveDown: jest.fn(function (lines = 1) {
        this.y += 15 * lines;
        return this;
      }),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      stroke: jest.fn().mockReturnThis(),
      addPage: jest.fn(function () {
        this.y = 72;
        return this;
      }),
      pipe: jest.fn(function (res) {
        this.res = res;
        return res;
      }),
      end: jest.fn(function () {
        this.res.end();
      })
    });

    const writtenText = (doc) => doc.text.mock.calls.map(([value]) => String(value));

    let doc;

    const mockReport = (client, workEntries) => {
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, client);
      });
      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, workEntries);
      });
    };

    beforeEach(() => {
      doc = createRecordingPdfDoc();
      PDFDocument.mockImplementationOnce(() => doc);
    });

    test('should write correct totals and every entry for a multi-entry report', async () => {
      const mockWorkEntries = [
        { date: '2024-01-04', hours: '7.25', description: 'Workshop', created_at: '2024-01-04' },
        { date: '2024-01-03', hours: 3, description: 'Code review', created_at: '2024-01-03' },
        { date: '2024-01-02', hours: 2.25, description: 'Planning', created_at: '2024-01-02' },
        { date: '2024-01-01', hours: 1.5, description: 'Kickoff call', created_at: '2024-01-01' }
      ];
      mockReport({ id: 1, name: 'Acme Corp' }, mockWorkEntries);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      const texts = writtenText(doc);
      expect(texts).toContain('Time Report for Acme Corp');
      expect(texts).toContain('Total Hours: 14.00');
      expect(texts).toContain('Total Entries: 4');
      mockWorkEntries.forEach((entry) => {
        expect(texts).toContain(entry.date);
        expect(texts).toContain(String(entry.hours));
        expect(texts).toContain(entry.description);
      });
      expect(doc.pipe).toHaveBeenCalledTimes(1);
      expect(doc.end).toHaveBeenCalledTimes(1);
    });

    test('should generate a PDF with zero totals and no rows when there are no entries', async () => {
      mockReport({ id: 1, name: 'Empty Client' }, []);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      const texts = writtenText(doc);
      expect(texts).toContain('Total Hours: 0.00');
      expect(texts).toContain('Total Entries: 0');
      expect(texts.slice(texts.indexOf('Description') + 1)).toEqual([]);
      expect(doc.addPage).not.toHaveBeenCalled();
      expect(doc.end).toHaveBeenCalledTimes(1);
    });

    test('should show "No description" for an entry without a description', async () => {
      mockReport({ id: 1, name: 'Acme Corp' }, [
        { date: '2024-01-02', hours: 2, description: 'Documented work', created_at: '2024-01-02' },
        { date: '2024-01-01', hours: 1, description: null, created_at: '2024-01-01' }
      ]);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      const texts = writtenText(doc);
      expect(texts.filter((text) => text === 'No description')).toHaveLength(1);
      expect(texts).toContain('Documented work');
    });

    test('should add a new page and still write every entry for a long report', async () => {
      const mockWorkEntries = Array.from({ length: 20 }, (_, i) => ({
        date: `2024-02-${String(20 - i).padStart(2, '0')}`,
        hours: 1,
        description: `Task ${i + 1}`,
        created_at: '2024-02-01'
      }));
      mockReport({ id: 1, name: 'Acme Corp' }, mockWorkEntries);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(doc.addPage).toHaveBeenCalled();
      const texts = writtenText(doc);
      expect(texts).toContain('Total Hours: 20.00');
      expect(texts).toContain('Total Entries: 20');
      mockWorkEntries.forEach((entry) => {
        expect(texts.filter((text) => text === entry.date)).toHaveLength(1);
        expect(texts).toContain(entry.description);
      });
      expect(doc.end).toHaveBeenCalledTimes(1);
    });

    test('should make the client name safe in the download filename', async () => {
      mockReport({ id: 1, name: 'Acme & Co / "Ltd"' }, []);

      const response = await request(app).get('/api/reports/export/pdf/1');

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="Acme___Co____Ltd__report_[A-Za-z0-9-]+\.pdf"$/
      );
    });
  });

  describe('CSV Export - successful generation', () => {
    let downloadSpy;

    afterEach(() => {
      downloadSpy.mockRestore();
    });

    test('should write entries to a temp CSV, download it with a safe filename and delete it', async () => {
      const mockWorkEntries = [
        { date: '2024-01-02', hours: 1.5, description: 'Work 2', created_at: '2024-01-02' },
        { date: '2024-01-01', hours: 7.25, description: 'Work 1', created_at: '2024-01-01' }
      ];
      mockDb.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, name: 'Acme & Co' });
      });
      mockDb.all.mockImplementation((query, params, callback) => {
        callback(null, mockWorkEntries);
      });

      const writeRecords = jest.fn().mockResolvedValue(undefined);
      const csvWriter = require('csv-writer');
      csvWriter.createObjectCsvWriter.mockReturnValue({ writeRecords });

      downloadSpy = jest.spyOn(app.response, 'download').mockImplementation(function (filePath, filename, callback) {
        this.status(200).end();
        callback(null);
      });

      const response = await request(app).get('/api/reports/export/csv/1');

      expect(response.status).toBe(200);
      expect(csvWriter.createObjectCsvWriter).toHaveBeenCalledWith({
        path: expect.stringMatching(/Acme___Co_report_[A-Za-z0-9-]+\.csv$/),
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
        expect.stringMatching(/^Acme___Co_report_[A-Za-z0-9-]+\.csv$/),
        expect.any(Function)
      );
      expect(fs.unlink).toHaveBeenCalledWith(tempPath, expect.any(Function));
    });
  });

  describe('Export Data Isolation', () => {
    const PDFDocument = require('pdfkit');

    beforeEach(() => {
      // The client exists but belongs to another user
      mockDb.get.mockImplementation((query, params, callback) => {
        const [clientId, userEmail] = params;
        const client = clientId === 1 && userEmail === 'other@example.com'
          ? { id: 1, name: 'Other User Client' }
          : undefined;
        callback(null, client);
      });
    });

    test.each(['pdf', 'csv'])('should return 404 for another user\'s client on %s export', async (format) => {
      const csvWriter = require('csv-writer');

      const response = await request(app).get(`/api/reports/export/${format}/1`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Client not found' });
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('user_email = ?'),
        [1, 'test@example.com'],
        expect.any(Function)
      );
      expect(mockDb.all).not.toHaveBeenCalled();
      expect(PDFDocument).not.toHaveBeenCalled();
      expect(csvWriter.createObjectCsvWriter).not.toHaveBeenCalled();
    });
  });
});
