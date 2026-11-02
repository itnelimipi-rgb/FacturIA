import {mailConfigured} from '../../../../server/mail';
import {aiConfigured} from '../../../../server/ai';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({emailDeliveryEnabled: mailConfigured(),
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    signUpEnabled: process.env.ALLOW_SIGNUP === 'true',
    aiEnabled: aiConfigured()}, {headers: {'Cache-Control': 'no-store'}});
}
