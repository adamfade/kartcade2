// ============================================================
// KARTCADE BOOKING SYSTEM v2.4 - 30-MIN BOOKING SUPPORT
// ============================================================
// CHANGES FROM v2.3:
// - FIXED: parseStationString now handles decimal durations (0.5h, 1.5h)
// - FIXED: getAvailability uses parseFloat (parseInt("0.5") was returning 0)
// - FIXED: getAvailabilityForStation blocks half-hour slots correctly
// - FIXED: createBooking parses decimal duration for calendar event length
// ============================================================

const SPREADSHEET = SpreadsheetApp.getActiveSpreadsheet();
const BOOKINGS_SHEET = SPREADSHEET.getSheetByName('Bookings');
const SETTINGS_SHEET = SPREADSHEET.getSheetByName('Settings');
const BLOCKED_SHEET = SPREADSHEET.getSheetByName('BlockedTimes');

// Station configuration
const STATIONS = {
    karts: { name: 'Racing Karts', settingKey: 'TotalKarts', priceKey: 'KartPrice', pricePerHour: 30 },
    rigs: { name: 'Full-Size Rigs', settingKey: 'TotalRigs', priceKey: 'RigPrice', pricePerHour: 40 },
    motion: { name: 'Motion Simulator', settingKey: 'TotalMotion', priceKey: 'MotionPrice', pricePerHour: 50 },
    flight: { name: 'Flight Simulator', settingKey: 'TotalFlight', priceKey: 'FlightPrice', pricePerHour: 40 }
};

// ============================================================
// PAYMENT CALCULATION HELPERS
// ============================================================

/**
 * Parse station string to extract equipment and duration
 * Format: "Racing Karts:3 (2h)" or "Karts:2, Rigs:1 (1.5h)"
 * FIX v2.4: regex now handles decimal durations like (0.5h) and (1.5h)
 */
function parseStationString(stationStr) {
    const equipment = [];

    // FIX v2.4: was /\((\d+)h\)/ — couldn't match 0.5h or 1.5h
    const durationMatch = String(stationStr).match(/\(([\d.]+)h\)/);
    const duration = durationMatch ? parseFloat(durationMatch[1]) : 1;

    // Remove duration from string
    const equipmentString = String(stationStr).replace(/\([\d.]+h\)/, '').trim();

    // Split by comma for multi-equipment
    const items = equipmentString.split(',');

    items.forEach(function (item) {
        const match = item.trim().match(/(.+):(\d+)/);
        if (match) {
            equipment.push({
                type: match[1].trim(),
                quantity: parseInt(match[2])
            });
        } else {
            const trimmed = item.trim();
            if (trimmed) {
                equipment.push({ type: trimmed, quantity: 1 });
            }
        }
    });

    return { equipment: equipment, duration: duration };
}

/**
 * Get price per hour for equipment type
 */
function getEquipmentPrice(equipmentType) {
    const normalizedType = String(equipmentType).toLowerCase();
    if (normalizedType.indexOf('kart') !== -1) return 30;
    if (normalizedType.indexOf('rig') !== -1) return 40;
    if (normalizedType.indexOf('motion') !== -1) return 50;
    if (normalizedType.indexOf('flight') !== -1) return 40;
    return 30;
}

/**
 * Calculate total cost from station string
 */
function calculateTotalCost(stationStr) {
    const isPartyBooking = String(stationStr).indexOf('Karts:5') !== -1 &&
        String(stationStr).indexOf('Rigs:3') !== -1 &&
        String(stationStr).indexOf('Motion:1') !== -1 &&
        String(stationStr).indexOf('Flight:1') !== -1;

    const parsed = parseStationString(stationStr);

    if (isPartyBooking) {
        if (parsed.duration === 2) return 400;
        if (parsed.duration === 3) return 600;
        if (parsed.duration === 4) return 800;
        return 400 + ((parsed.duration - 2) * 200);
    }

    let total = 0;
    parsed.equipment.forEach(function (item) {
        const pricePerHour = getEquipmentPrice(item.type);
        total += item.quantity * parsed.duration * pricePerHour;
    });
    return total;
}

/**
 * Calculate paid amount based on payment method
 */
function calculatePaidAmount(paymentMethod, totalCost) {
    const method = String(paymentMethod || 'venue').toLowerCase().trim();

    // FIX v2.5: Check paypal_deposit FIRST — must be before the generic 'paypal' check
    // because indexOf('paypal') matches BOTH 'paypal' and 'paypal_deposit'
    if (method === 'paypal_deposit' || method === 'deposit' || method.indexOf('deposit') !== -1) {
        return Math.round(totalCost * 0.5);
    }

    if (method === 'paypal' || method.indexOf('paypal') !== -1 ||
        method === 'credits' || method.indexOf('credit') !== -1 ||
        method === 'stripe' || method === 'online') {
        return totalCost; // Paid in full
    }

    return 0; // Pay at venue — nothing collected yet
}

/**
 * Generate payment status string for Google Sheet
 */
function generatePaymentStatus(stationStr, paymentMethod) {
    const total = calculateTotalCost(stationStr);
    const paid = calculatePaidAmount(paymentMethod, total);
    const remaining = total - paid;
    return 'Paid: $' + paid + ' / Remaining: $' + remaining;
}

// ============================================================
// CORE HANDLERS
// ============================================================

function doGet(e) { return handleRequest(e); }

function doPost(e) {
    let params = e;
    if (e.postData && e.postData.contents) {
        const data = JSON.parse(e.postData.contents);
        params = { parameter: data };
    }
    return handleRequest(params);
}

function handleRequest(e) {
    try {
        const action = e.parameter.action;

        if (action === 'availability') {
            return getAvailability(e.parameter.date, e.parameter.station, e.parameter.duration);
        }
        if (action === 'settings') { return getSettings(); }
        if (action === 'batchBook') {
            const items = JSON.parse(e.parameter.items || '[]');
            const userDetails = {
                name: e.parameter.name,
                email: e.parameter.email,
                phone: e.parameter.phone,
                paymentMethod: e.parameter.paymentMethod || 'venue',
                notes: e.parameter.notes || ''
            };
            return createBatchBooking(items, userDetails);
        }
        if (action === 'book') {
            const bookingData = {
                date: e.parameter.date,
                time: e.parameter.time,
                station: e.parameter.station,
                drivers: parseInt(e.parameter.drivers) || 1,
                name: e.parameter.name,
                email: e.parameter.email,
                phone: e.parameter.phone,
                paymentMethod: e.parameter.paymentMethod || 'venue',
                notes: e.parameter.notes || '',
                durationMinutes: parseInt(e.parameter.durationMinutes) || 0
            };
            return createBooking(bookingData);
        }
        if (action === 'userBookings') { return getUserBookings(e.parameter.email); }
        if (action === 'cancel') { return cancelBooking(e.parameter.id); }
        if (action === 'emailReport') {
            // v2.5: weekly marketing scorecard from the website's sync job
            if (!isAdminKey(e.parameter.key)) return createResponse({ success: false, error: 'unauthorized' });
            const to = String(e.parameter.to || 'kartcade.website@gmail.com');
            MailApp.sendEmail(to, String(e.parameter.subject || 'Kartcade weekly scorecard'), String(e.parameter.body || ''));
            return createResponse({ success: true });
        }
        if (action === 'allBookings') {
            // v2.5: customer data needs the admin key (Script Properties -> ADMIN_KEY)
            if (!isAdminKey(e.parameter.key)) return createResponse({ success: false, error: 'unauthorized' });
            return getAllBookings(e.parameter.full === '1');
        }
        if (action === 'getBooking') { return getBooking(e.parameter.id); }

        return createResponse({ error: 'Invalid action: ' + action }, 400);
    } catch (error) {
        return createResponse({ error: error.message }, 500);
    }
}

// ============================================================
// AVAILABILITY LOGIC
// ============================================================

function getAvailability(dateStr, stationId, durationStr) {
    // FIX v2.4: was parseInt — parseInt("0.5") = 0, falling back to 1 hour
    const duration = parseFloat(durationStr) || 1;

    if (!stationId || stationId === 'all') {
        const result = {};
        for (const key in STATIONS) {
            result[key] = getAvailabilityForStation(dateStr, key, duration);
        }
        return createResponse({ success: true, date: dateStr, availability: result });
    }

    const avail = getAvailabilityForStation(dateStr, stationId, duration);
    return createResponse({ date: dateStr, station: stationId, availability: avail });
}

// v2.5: opening hours by weekday (0 = Sunday). null = closed.
// Keep in sync with HOURS_BY_DAY in the website's config/booking.ts.
const HOURS_BY_DAY = {
    0: [10, 19], // Sunday 10am-7pm
    1: null,     // Monday closed
    2: null,     // Tuesday closed
    3: [14, 20], // Wednesday 2pm-8pm
    4: [14, 20], // Thursday 2pm-8pm
    5: [14, 21], // Friday 2pm-9pm
    6: [10, 21]  // Saturday 10am-9pm
};

function getHoursForDate(dateStr) {
    const parts = String(dateStr).split('-').map(Number);
    const day = new Date(parts[0], parts[1] - 1, parts[2], 12).getDay();
    return HOURS_BY_DAY[day] || null;
}

function getAvailabilityForStation(dateStr, stationId, duration) {
    const station = STATIONS[stationId];
    if (!station) return {};

    const totalUnits = getSetting(station.settingKey) || 1;
    const dayHours = getHoursForDate(dateStr);
    if (!dayHours) return {}; // closed that day
    const openHour = dayHours[0];
    const closeHour = dayHours[1];

    const bookedSlots = {};

    function extractQuantityFromBooking(stationStr, targetId) {
        const lower = String(stationStr).toLowerCase();
        const shortNames = { karts: 'karts', rigs: 'rigs', motion: 'motion', flight: 'flight' };
        const shortName = shortNames[targetId];
        if (!shortName) return 0;
        const regex = new RegExp(shortName + ':(\\d+)', 'i');
        const match = lower.match(regex);
        if (match) return parseInt(match[1]) || 0;
        if (lower === station.name.toLowerCase()) return 1;
        return 0;
    }

    const bookings = BOOKINGS_SHEET.getDataRange().getValues();
    for (let i = 1; i < bookings.length; i++) {
        const row = bookings[i];
        if (row[9] === 'Cancelled') continue;

        const bDate = normalizeDate(row[1]);
        const bTime = normalizeTime(row[2]);
        const bStation = String(row[3]).trim();

        // FIX v2.4: was /\((\d+)h\)/ + parseInt — couldn't handle (0.5h) or (1.5h)
        const durationMatch = bStation.match(/\(([\d.]+)h\)/);
        const bookingDuration = durationMatch ? parseFloat(durationMatch[1]) : 1;

        if (bDate === dateStr) {
            const qty = extractQuantityFromBooking(bStation, stationId);
            if (qty > 0) {
                const startHour = parseInt(bTime.split(':')[0]);

                // FIX v2.4: Math.ceil handles half-hours correctly without double-counting
                // 0.5h → ceil=1 hour blocked, 1h → 1hr, 1.5h → 2hrs, 2h → 2hrs
                const hoursToBlock = Math.ceil(bookingDuration);
                for (let h = 0; h < hoursToBlock; h++) {
                    const hourKey = (startHour + h) + ':00';
                    if (!bookedSlots[hourKey]) bookedSlots[hourKey] = 0;
                    bookedSlots[hourKey] += qty;
                }
            }
        }
    }

    const blocked = getBlockedSlots(dateStr);

    const availability = {};
    for (let hour = openHour; hour < closeHour; hour++) {
        const timeStr = hour + ':00';
        let isAvailable = true;
        let minAvailableMsg = totalUnits;

        // Check all hours this booking would span (e.g. 1.5h = check hour 0 and hour 1)
        const hoursToCheck = Math.ceil(duration);
        for (let d = 0; d < hoursToCheck; d++) {
            const checkHour = hour + d;
            if (checkHour >= closeHour || blocked.indexOf(checkHour + ':00') !== -1) {
                isAvailable = false;
                minAvailableMsg = 0;
                break;
            }
            const booked = bookedSlots[checkHour + ':00'] || 0;
            const remaining = Math.max(0, totalUnits - booked);
            if (remaining <= 0) {
                isAvailable = false;
                minAvailableMsg = 0;
                break;
            }
            minAvailableMsg = Math.min(minAvailableMsg, remaining);
        }

        availability[timeStr] = {
            total: totalUnits,
            available: isAvailable ? minAvailableMsg : 0
        };
    }

    return availability;
}

function getBlockedSlots(dateStr) {
    if (!BLOCKED_SHEET) return [];
    const blocked = [];
    const rows = BLOCKED_SHEET.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;
        const bDate = normalizeDate(row[0]);
        if (bDate !== dateStr) continue;
        const startHour = parseHour(row[1]);
        const endHour = parseHour(row[2]);
        if (startHour !== null && endHour !== null) {
            for (let h = startHour; h < endHour; h++) {
                blocked.push(h + ':00');
            }
        }
    }
    return blocked;
}

function getSettings() {
    const settings = {};
    const rows = SETTINGS_SHEET.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
        settings[rows[i][0]] = rows[i][1];
    }
    return createResponse({ success: true, settings: settings });
}

// ============================================================
// BOOKING CREATION
// ============================================================

function createBatchBooking(items, user) {
    const bookingId = generateBookingId();
    const createdAt = new Date();
    const bookedItems = [];
    let totalPrice = 0;

    for (const i in items) {
        const item = items[i];
        const station = STATIONS[item.station];
        if (!station) continue;

        const stationName = station.name;
        const paymentStatus = generatePaymentStatus(stationName + ":" + item.drivers + " (1h)", user.paymentMethod);

        BOOKINGS_SHEET.appendRow([
            bookingId, item.date, item.time, station.name, item.drivers,
            user.name, user.email, user.phone, user.paymentMethod, 'Confirmed', createdAt, paymentStatus
        ]);

        const price = getSetting(station.priceKey) || 0;
        totalPrice += (price * item.drivers);
        bookedItems.push({ name: station.name, date: item.date, time: item.time, drivers: item.drivers });
        createCalendarEvent({ name: user.name, email: user.email, phone: user.phone, date: item.date, time: item.time, drivers: item.drivers, notes: user.notes }, bookingId, station.name, 1);
    }

    sendBatchEmail(user, bookingId, bookedItems, totalPrice);
    sendOwnerBatchNotification(user, bookingId, bookedItems, totalPrice);

    return createResponse({ success: true, bookingId: bookingId, message: 'Batch booking confirmed' });
}

function createBooking(data) {
    const bookingId = generateBookingId();
    const createdAt = new Date();

    const stationDisplay = data.station || 'Unknown';

    // FIX v2.4: was /\((\d+)h\)/ + parseInt — now handles (0.5h), (1.5h) etc.
    // Also: if webhook sends durationMinutes param, use that for precise calendar blocking
    let durationHours;
    if (data.durationMinutes && data.durationMinutes > 0) {
        durationHours = data.durationMinutes / 60;
    } else {
        const durationMatch = stationDisplay.match(/\(([\d.]+)h\)/);
        durationHours = durationMatch ? parseFloat(durationMatch[1]) : 1;
    }

    const paymentStatus = generatePaymentStatus(stationDisplay, data.paymentMethod);

    BOOKINGS_SHEET.appendRow([
        bookingId, data.date, data.time, stationDisplay, data.drivers,
        data.name, data.email, data.phone, data.paymentMethod || 'venue',
        'Confirmed', createdAt, paymentStatus
    ]);

    try { sendConfirmationEmail(data, bookingId, stationDisplay, durationHours); } catch (e) { }
    try { sendOwnerNotification(data, bookingId, stationDisplay, durationHours); } catch (e) { }
    try { createCalendarEvent(data, bookingId, stationDisplay, durationHours); } catch (e) { }

    return createResponse({ success: true, bookingId: bookingId, message: 'Booking confirmed!' });
}

// ============================================================
// NOTIFICATIONS & CALENDAR
// ============================================================

function sendBatchEmail(user, bookingId, items, total) {
    const subject = 'Kartcade Booking Confirmed - ' + bookingId;
    let itemsHtml = items.map(function (i) {
        return '- ' + i.name + ': ' + i.date + ' @ ' + i.time + ' (' + i.drivers + ' drivers)';
    }).join('\n');
    const body = '\n🏎️ KARTCADE BOOKING CONFIRMATION\n\nBooking ID: ' + bookingId + '\nTotal: $' + total + '\n\nITEMS RESERVED:\n' + itemsHtml + '\n\nPayment: ' + user.paymentMethod + '\n\n📍 Location: West Linn, Oregon\n📧 Questions? Email info@kartcade.com\n    ';
    MailApp.sendEmail(user.email, subject, body);
}

function sendOwnerBatchNotification(user, bookingId, items, total) {
    const ownerEmail = 'kartcade.website@gmail.com';
    const subject = '🏎️ New BATCH Booking: ' + user.name;
    let itemsHtml = items.map(function (i) {
        return '- ' + i.name + ': ' + i.date + ' @ ' + i.time + ' (' + i.drivers + ')';
    }).join('\n');
    const body = '\nNEW BOOKING\nUser: ' + user.name + ' (' + user.email + ')\nPhone: ' + user.phone + '\n\n' + itemsHtml + '\n\nTotal: $' + total + '\nNotes: ' + user.notes + '\n    ';
    MailApp.sendEmail(ownerEmail, subject, body);
}

function sendConfirmationEmail(data, bookingId, stationDisplay, durationHours) {
    const cancelUrl = 'https://kartcade.com/cancel?id=' + bookingId;
    // Show duration nicely: 0.5 → "30 min", 1.5 → "1h 30m", 2 → "2 hours"
    const durationLabel = formatDurationLabel(durationHours);
    const body = '\n🏎️ KARTCADE BOOKING CONFIRMATION\n\nBooking ID: ' + bookingId + '\nEquipment: ' + stationDisplay + '\nDate: ' + data.date + '\nTime: ' + data.time + '\nDuration: ' + durationLabel + '\nDrivers: ' + data.drivers + '\n\n📍 Location: West Linn, Oregon\n📧 Questions? Email info@kartcade.com\n\nNeed to cancel? Visit: ' + cancelUrl + '\n\nThank you for booking with Kartcade!\n- The Kartcade Team\n    ';
    MailApp.sendEmail(data.email, 'Kartcade Booking - ' + bookingId, body);
}

function sendOwnerNotification(data, bookingId, stationDisplay, durationHours) {
    const ownerEmail = 'kartcade.website@gmail.com';
    const durationLabel = formatDurationLabel(durationHours);
    const body = '\n🏎️ NEW BOOKING\n\nID: ' + bookingId + '\nCustomer: ' + data.name + '\nEmail: ' + data.email + '\nPhone: ' + data.phone + '\n\nEquipment: ' + stationDisplay + '\nDate: ' + data.date + '\nTime: ' + data.time + ' (' + durationLabel + ')\nDrivers: ' + data.drivers + '\nPayment: ' + data.paymentMethod + '\nNotes: ' + (data.notes || 'None') + '\n    ';
    MailApp.sendEmail(ownerEmail, 'New Booking: ' + data.name + ' - ' + stationDisplay, body);
}

/**
 * NEW v2.4: Format duration as human-readable label
 * 0.5 → "30 min", 1 → "1 hour", 1.5 → "1h 30m", 2 → "2 hours"
 */
function formatDurationLabel(hours) {
    if (hours === 0.5) return '30 min';
    const wholeHours = Math.floor(hours);
    const halfHour = (hours % 1) >= 0.5;
    let label = '';
    if (wholeHours > 0) label += wholeHours + (wholeHours === 1 ? ' hour' : ' hours');
    if (halfHour) label += (label ? ' 30m' : '30 min');
    return label || hours + 'h';
}

function sendCancellationEmail(booking) {
    const subject = 'Kartcade Booking Cancelled - ' + booking.id;
    const body = '\n🏎️ KARTCADE BOOKING CANCELLED\n\nHi ' + booking.name + ',\n\nYour booking has been successfully cancelled.\n\nBooking ID: ' + booking.id + '\nEquipment: ' + booking.station + '\nDate: ' + booking.date + '\nTime: ' + booking.time + '\n\nIf you\'d like to rebook, visit: \nhttps://www.kartcade.com/book\n\nQuestions? Email info@kartcade.com\n\nThank you,\n- The Kartcade Team';
    MailApp.sendEmail(booking.email, subject, body);
}

function sendOwnerCancellationNotification(booking) {
    const ownerEmail = 'kartcade.website@gmail.com';
    const subject = '🛑 Booking CANCELLED: ' + booking.name + ' - ' + booking.id;
    const body = '\nBOOKING CANCELLED\n\nID: ' + booking.id + '\nCustomer: ' + booking.name + '\nEmail: ' + booking.email + '\nPhone: ' + booking.phone + '\n\nEquipment: ' + booking.station + '\nDate: ' + booking.date + ' @ ' + booking.time + '\nPayment Method: ' + booking.paymentMethod + '\n';
    MailApp.sendEmail(ownerEmail, subject, body);
}

function createCalendarEvent(data, bookingId, stationDisplay, durationHours) {
    var calendar = CalendarApp.getDefaultCalendar();
    var dateParts = data.date.split('-');
    var timeParts = data.time.split(':');
    var start = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1] || 0);
    // FIX v2.4: durationHours can now be 0.5, 1.5 etc — calendar event length is exact
    var end = new Date(start.getTime() + (durationHours * 3600 * 1000));

    var event = calendar.createEvent('🏎️ ' + data.name + ' - ' + stationDisplay, start, end, {
        description: 'Booking ID: ' + bookingId + '\nDrivers: ' + data.drivers + '\nPhone: ' + data.phone + '\nEmail: ' + data.email + '\n\nNotes: ' + (data.notes || 'None')
    });
    event.setColor('2');
}

function removeCalendarEvent(bookingId, dateStr, timeStr) {
    var calendar = CalendarApp.getDefaultCalendar();
    var dateParts = dateStr.split('-');
    var startOfDay = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0);
    var endOfDay = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 23, 59, 59);
    var events = calendar.getEvents(startOfDay, endOfDay);
    for (var i = 0; i < events.length; i++) {
        var event = events[i];
        if (event.getDescription().indexOf('Booking ID: ' + bookingId) !== -1) {
            event.deleteEvent();
        }
    }
}

// ============================================================
// HELPERS
// ============================================================

function generateBookingId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'K';
    for (let i = 0; i < 5; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

function getSetting(key) {
    const data = SETTINGS_SHEET.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === key) return data[i][1];
    }
    return null;
}

function normalizeDate(val) {
    if (val instanceof Date) {
        return Utilities.formatDate(val, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    }
    if (typeof val === 'string' && val.indexOf('T') !== -1) return val.split('T')[0];
    return String(val).trim();
}

function normalizeTime(val) {
    if (val instanceof Date) {
        return Utilities.formatDate(val, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'HH:mm');
    }
    return String(val).substring(0, 5);
}

function parseHour(val) {
    const t = normalizeTime(val);
    const parts = t.split(':');
    return parseInt(parts[0]);
}

// v2.5: shared secret for admin-only actions. Set it once in
// Project Settings -> Script Properties -> ADMIN_KEY (same value as APPS_SCRIPT_ADMIN_KEY in Vercel).
function isAdminKey(key) {
    const secret = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    return !!secret && !!key && String(key) === secret;
}

function createResponse(data, status) {
    status = status || 200;
    const output = ContentService.createTextOutput(JSON.stringify(data));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
}

function cancelBooking(id) {
    const data = BOOKINGS_SHEET.getDataRange().getValues();
    let found = false;
    let mainBooking = null;

    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === id && data[i][9] !== 'Cancelled') {
            BOOKINGS_SHEET.getRange(i + 1, 10).setValue('Cancelled');
            found = true;
            if (!mainBooking) {
                mainBooking = {
                    id: data[i][0], date: normalizeDate(data[i][1]), time: normalizeTime(data[i][2]),
                    station: data[i][3], drivers: data[i][4], name: data[i][5],
                    email: data[i][6], phone: data[i][7], paymentMethod: data[i][8]
                };
            }
            try { removeCalendarEvent(id, normalizeDate(data[i][1]), normalizeTime(data[i][2])); } catch (e) { Logger.log("Calendar removal failed: " + e); }
        }
    }

    if (found && mainBooking) {
        try { sendCancellationEmail(mainBooking); } catch (e) { }
        try { sendOwnerCancellationNotification(mainBooking); } catch (e) { }
        return createResponse({ success: true });
    }
    return createResponse({ error: 'Booking not found or already cancelled' });
}

function getBooking(id) {
    const bookings = BOOKINGS_SHEET.getDataRange().getValues();
    for (let i = 1; i < bookings.length; i++) {
        if (bookings[i][0] === id) {
            return createResponse({
                success: true,
                booking: {
                    id: bookings[i][0], date: normalizeDate(bookings[i][1]), time: normalizeTime(bookings[i][2]),
                    station: bookings[i][3], drivers: bookings[i][4], name: bookings[i][5],
                    email: bookings[i][6], phone: bookings[i][7], paymentMethod: bookings[i][8], status: bookings[i][9]
                }
            });
        }
    }
    return createResponse({ success: false, error: 'Booking not found' });
}

function getUserBookings(email) {
    const rows = BOOKINGS_SHEET.getDataRange().getValues();
    const result = [];
    const today = new Date().toISOString().split('T')[0];
    for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][6]).toLowerCase() === email.toLowerCase() && rows[i][9] !== 'Cancelled') {
            if (normalizeDate(rows[i][1]) >= today) {
                result.push({
                    id: rows[i][0], date: normalizeDate(rows[i][1]), time: normalizeTime(rows[i][2]),
                    station: rows[i][3], drivers: rows[i][4], status: rows[i][9]
                });
            }
        }
    }
    return createResponse({ success: true, bookings: result });
}

function getAllBookings(full) {
    const rows = BOOKINGS_SHEET.getDataRange().getValues();
    const today = new Date();
    const todayStr = Utilities.formatDate(today, 'America/Los_Angeles', 'yyyy-MM-dd');
    const todayBookings = [], upcomingBookings = [], pastBookings = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const status = row[9] || 'Pending';
        const booking = {
            id: row[0], date: normalizeDate(row[1]), time: normalizeTime(row[2]),
            station: row[3], drivers: row[4], name: row[5], email: row[6],
            phone: row[7], paymentMethod: row[8], status: status
        };
        if (status === 'Cancelled') { pastBookings.push(booking); continue; }
        if (booking.date === todayStr) todayBookings.push(booking);
        else if (booking.date > todayStr) upcomingBookings.push(booking);
        else pastBookings.push(booking);
    }

    const sortByDateTime = function (a, b) {
        if (a.date !== b.date) return a.date > b.date ? 1 : -1;
        return a.time > b.time ? 1 : -1;
    };
    todayBookings.sort(sortByDateTime);
    upcomingBookings.sort(sortByDateTime);
    pastBookings.sort(sortByDateTime).reverse();

    return createResponse({
        success: true,
        today: todayBookings,
        upcoming: upcomingBookings,
        past: full ? pastBookings : pastBookings.slice(0, 50),
        full: !!full,
        stats: { todayCount: todayBookings.length, upcomingCount: upcomingBookings.length, pastCount: pastBookings.length }
    });
}

