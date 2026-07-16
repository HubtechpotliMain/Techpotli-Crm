import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PaymentStatus, UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { CurrentUser, JwtPayload } from '../common/decorators/user.decorator';
import { Roles } from '../common/decorators/metadata.decorator';
import { RolesGuard } from '../common/guards/auth.guards';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

@Controller('payments')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Get('summary')
  summary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    return this.payments.summary(user.role, user.sub, { from, to, userId });
  }

  @Get('export')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Header('Content-Type', 'text/csv')
  async export(@CurrentUser() user: JwtPayload, @Query('month') month?: string) {
    const { csv, filename } = await this.payments.exportCsv(user.role, month);
    return { csv, filename };
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string,
    @Query('status') status?: PaymentStatus,
    @Query('userId') userId?: string,
    @Query('customerId') customerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payments.findAll(user.role, user.sub, {
      q,
      status,
      userId,
      customerId,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('includeProof') includeProof?: string,
  ) {
    return this.payments.findOne(id, user.role, user.sub, {
      includeProof: includeProof === '1' || includeProof === 'true',
    });
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreatePaymentDto) {
    return this.payments.create(body, user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() body: UpdatePaymentDto) {
    return this.payments.update(id, body, user.role, user.sub);
  }

  @Post(':id/generate-invoice')
  generateInvoice(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payments.generateInvoice(id, user.role, user.sub);
  }

  @Post(':id/verify')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  verify(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payments.update(id, { verify: true }, user.role, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payments.remove(id, user.role, user.sub);
  }
}
