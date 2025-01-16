
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    try {
        console.log('Received event:', JSON.stringify(event));
        
        // Parse the request body first
        const requestData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

        // Check if it's an OPTIONS request
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': 'http://my-ssoffice-bucket.s3-website-us-east-1.amazonaws.com',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                },
                body: JSON.stringify({})
            };
        }

        // Make sure we're only handling POST requests
        if (event.httpMethod !== 'POST' && event.requestContext?.http?.method !== 'POST') {
            return createResponse(405, { error: 'Method not allowed' });
        }

        // Route based on action
        switch (requestData.action) {
            case 'getSeatMap': {
                const { flightId } = requestData;
                if (!flightId) {
                    return createResponse(400, { error: 'Flight ID is required' });
                }
                const seatMap = await getSeatMap(flightId);
                return createResponse(200, seatMap);
            }

            case 'reserveSeats': {
                const { flightId, seats, passengers } = requestData;
                
                // Validate input
                if (!flightId || !seats || !passengers) {
                    return createResponse(400, { 
                        error: 'Missing required fields: flightId, seats, and passengers are required' 
                    });
                }

                if (!validateSeatSelection(seats, passengers)) {
                    return createResponse(400, { error: 'Invalid seat selection' });
                }
                
                // Get current flight data
                const flight = await getFlight(flightId);
                
                // Validate seat availability
                if (!validateSeatAvailability(seats, flight)) {
                    return createResponse(409, { error: 'Selected seats are no longer available' });
                }
                
                // Validate emergency exit row restrictions
                if (!validateEmergencyExitRows(seats, passengers, flight)) {
                    return createResponse(400, { error: 'Invalid emergency exit row selection' });
                }
                
                // Reserve seats
                await reserveSeats(flightId, seats);
                
                // Calculate additional costs for premium seats
                const totalCost = calculateSeatCost(seats, flight);
                
                return createResponse(200, {
                    success: true,
                    seatAssignments: seats,
                    additionalCost: totalCost
                });
            }

            default:
                return createResponse(400, { error: 'Invalid action specified' });
        }
    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, { 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

// Helper functions remain the same
async function getSeatMap(flightId) {
    const params = {
        TableName: 'Flights',
        Key: { flightId }
    };
    
    try {
        const { Item: flight } = await docClient.send(new GetCommand(params));
        if (!flight) {
            throw new Error('Flight not found');
        }
        
        return {
            seats: generateSeatMap(flight),
            emergencyExitRows: flight.emergencyExitRows,
            premiumSeats: flight.premiumSeats
        };
    } catch (error) {
        console.error('Error getting seat map:', error);
        throw error;
    }
}

function generateSeatMap(flight) {
    const rows = 30;
    const seatsPerRow = 6;
    const seatMap = [];
    
    for (let row = 1; row <= rows; row++) {
        for (let seatNum = 0; seatNum < seatsPerRow; seatNum++) {
            const seatLetter = String.fromCharCode(65 + seatNum);
            const seatId = `${row}${seatLetter}`;
            
            seatMap.push({
                id: seatId,
                number: seatId,
                status: flight.occupiedSeats.includes(seatId) ? 'occupied' : 'available',
                isEmergencyExit: flight.emergencyExitRows.includes(row),
                isPremium: flight.premiumSeats.includes(seatId)
            });
        }
    }
    
    return seatMap;
}

async function getFlight(flightId) {
    const params = {
        TableName: 'Flights',
        Key: { flightId }
    };
    
    const { Item: flight } = await docClient.send(new GetCommand(params));
    if (!flight) {
        throw new Error('Flight not found');
    }
    
    return flight;
}

async function reserveSeats(flightId, seats) {
    const params = {
        TableName: 'Flights',
        Key: { flightId },
        UpdateExpression: 'SET occupiedSeats = list_append(occupiedSeats, :seats)',
        ExpressionAttributeValues: {
            ':seats': seats
        },
        ConditionExpression: 'attribute_exists(flightId)'
    };
    
    try {
        await docClient.send(new UpdateCommand(params));
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            throw new Error('Concurrent seat reservation detected');
        }
        throw error;
    }
}

function validateSeatSelection(seats, passengers) {
    // First check if we have seats array
    if (!Array.isArray(seats)) {
        console.log('Seats is not an array:', seats);
        return false;
    }

    // It's OK to select no seats initially
    if (seats.length === 0) {
        return true;
    }

    // Check if we have the correct number of seats for passengers
    if (seats.length > passengers.length) {
        console.log('Too many seats selected:', seats.length, 'for', passengers.length, 'passengers');
        return false;
    }

    // Validate seat format
    const seatPattern = /^[1-9]\d?[A-F]$/;  // Matches patterns like 1A, 2F, 10A, etc.
    const validSeats = seats.every(seat => {
        const isValid = seatPattern.test(seat);
        if (!isValid) {
            console.log('Invalid seat format:', seat);
        }
        return isValid;
    });

    return validSeats;
}

function validateSeatAvailability(seats, flight) {
    // If no seats are being selected, that's ok
    if (seats.length === 0) {
        return true;
    }

    // Check if any of the selected seats are already occupied
    const unavailableSeats = seats.filter(seat => 
        flight.occupiedSeats && flight.occupiedSeats.includes(seat)
    );

    if (unavailableSeats.length > 0) {
        console.log('These seats are already occupied:', unavailableSeats);
        return false;
    }

    return true;
}

function validateEmergencyExitRows(seats, passengers, flight) {
    // If no seats selected, that's ok
    if (seats.length === 0) {
        return true;
    }

    return seats.every((seat, index) => {
        const row = parseInt(seat);
        if (flight.emergencyExitRows && flight.emergencyExitRows.includes(row)) {
            return isEligibleForEmergencyRow(passengers[index]);
        }
        return true;
    });
}



function isEligibleForEmergencyRow(passenger) {
    const age = calculateAge(passenger.dateOfBirth);
    return age >= 15 && age <= 75;
}

function calculateAge(dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    return age;
}

function calculateSeatCost(seats, flight) {
    return seats.reduce((total, seat) => {
        if (flight.premiumSeats.includes(seat)) {
            return total + flight.premiumSeatCost;
        }
        return total;
    }, 0);
}

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": "http://my-ssoffice-bucket.s3-website-us-east-1.amazonaws.com",
            "Access-Control-Allow-Credentials": true,
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "OPTIONS,POST",  // Removed GET, only allowing POST and OPTIONS
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    };
}